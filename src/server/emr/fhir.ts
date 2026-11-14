import "server-only";
import type { ClinicContext } from "../auth/clinic-auth";
import type { RequestMeta } from "../auth/platform-auth";
import { auditClinic, requirePermission } from "../clinic/context";
import { DomainError } from "../tenancy/provisioning";
import { withRecordAccess } from "./access";
import { VITALS } from "./record";

/**
 * HL7 FHIR R4 export of one patient's record as a "collection" Bundle, built
 * only from published FHIR/HL7 terminology (ICD-10, LOINC, UCUM, v3 codes).
 *
 * This prepares data for exchange (e.g. DMED, which per public statements is
 * FHIR-based); it does NOT transmit anything. Identifier systems for PINFL and
 * other national identifiers are clinic-local URNs until the official system
 * URIs are confirmed with the national exchange — they are not guesses at
 * official values. Signed clinical notes are not included yet.
 */

const SYS = {
  icd10: "http://hl7.org/fhir/sid/icd-10",
  loinc: "http://loinc.org",
  ucum: "http://unitsofmeasure.org",
  actCode: "http://terminology.hl7.org/CodeSystem/v3-ActCode",
  obsCategory: "http://terminology.hl7.org/CodeSystem/observation-category",
  interpretation: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation",
  conditionClinical: "http://terminology.hl7.org/CodeSystem/condition-clinical",
  conditionCategory: "http://terminology.hl7.org/CodeSystem/condition-category",
  allergyClinical: "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical",
} as const;

type Resource = Record<string, unknown> & { resourceType: string; id: string };
export interface FhirBundle {
  resourceType: "Bundle";
  id: string;
  type: "collection";
  timestamp: string;
  entry: { fullUrl: string; resource: Resource }[];
}

const ref = (id: string) => ({ reference: `urn:uuid:${id}` });
const iso = (d: Date) => d.toISOString();
const dateOnly = (d: Date) => d.toISOString().slice(0, 10);

/** Builds the bundle for a patient in the caller's care (or head-doctor oversight). Audited. */
export async function exportPatientFhir(ctx: ClinicContext, patientId: string, meta: RequestMeta): Promise<FhirBundle> {
  requirePermission(ctx, "emr.read");
  return withRecordAccess(ctx, patientId, meta, { auditView: false }, async (tx, access) => {
    // A bulk export is never allowed under break-the-glass.
    if (access.mode !== "care" && access.mode !== "oversight") throw new DomainError("errors.noCareRelationship");

    const patient = await tx.patient.findUniqueOrThrow({ where: { id: patientId } });
    const identifiers = await tx.patientIdentifier.findMany({ where: { patientId } });
    const encounters = await tx.encounter.findMany({
      where: { patientId },
      include: { doctor: { select: { membership: { select: { user: { select: { fullName: true } } } } } } },
      orderBy: { startedAt: "asc" },
    });
    const diagnoses = await tx.diagnosis.findMany({ where: { patientId, status: { not: "ENTERED_IN_ERROR" } }, orderBy: { recordedAt: "asc" } });
    const allergies = await tx.allergy.findMany({ where: { patientId, status: { not: "ENTERED_IN_ERROR" } } });
    const vitals = await tx.vitalSign.findMany({ where: { patientId }, orderBy: { measuredAt: "asc" } });
    const labs = await tx.labOrder.findMany({
      where: { patientId, status: "VERIFIED" },
      include: { items: { include: { results: { include: { analyte: { select: { name: true, loinc: true } } } } } } },
      orderBy: { verifiedAt: "asc" },
    });

    const entries: Resource[] = [];
    entries.push({
      resourceType: "Patient",
      id: patient.id,
      identifier: [
        { use: "usual", system: `urn:itopmed:${ctx.tenant.slug}:mrn`, value: patient.mrn },
        ...identifiers.map((i) => ({ system: `urn:itopmed:identifier:${i.type.toLowerCase()}`, value: i.value })),
      ],
      name: [{ use: "official", family: patient.lastName, given: [patient.firstName, ...(patient.middleName ? [patient.middleName] : [])] }],
      gender: patient.sex === "MALE" ? "male" : patient.sex === "FEMALE" ? "female" : "unknown",
      birthDate: dateOnly(patient.birthDate),
      telecom: [...(patient.phone ? [{ system: "phone", value: patient.phone }] : []), ...(patient.email ? [{ system: "email", value: patient.email }] : [])],
    });

    for (const e of encounters) {
      entries.push({
        resourceType: "Encounter",
        id: e.id,
        status: e.status === "OPEN" ? "in-progress" : "finished",
        class: { system: SYS.actCode, code: "AMB", display: "ambulatory" },
        subject: ref(patient.id),
        participant: [{ individual: { display: e.doctor.membership.user.fullName } }],
        period: { start: iso(e.startedAt), ...(e.closedAt ? { end: iso(e.closedAt) } : {}) },
      });
    }

    for (const d of diagnoses) {
      entries.push({
        resourceType: "Condition",
        id: d.id,
        clinicalStatus: { coding: [{ system: SYS.conditionClinical, code: d.status === "RESOLVED" ? "resolved" : "active" }] },
        category: [{ coding: [{ system: SYS.conditionCategory, code: "encounter-diagnosis" }] }],
        // A text-only diagnosis (no ICD-10 code yet) has no coding, only text.
        code: d.icd10Code ? { coding: [{ system: SYS.icd10, code: d.icd10Code, display: d.description }], text: d.description } : { text: d.description },
        subject: ref(patient.id),
        ...(d.encounterId ? { encounter: ref(d.encounterId) } : {}),
        recordedDate: iso(d.recordedAt),
      });
    }

    for (const a of allergies) {
      entries.push({
        resourceType: "AllergyIntolerance",
        id: a.id,
        clinicalStatus: { coding: [{ system: SYS.allergyClinical, code: a.status === "RESOLVED" ? "resolved" : "active" }] },
        criticality: a.severity === "SEVERE" ? "high" : a.severity === "UNKNOWN" ? "unable-to-assess" : "low",
        code: { text: a.substance },
        patient: ref(patient.id),
        recordedDate: iso(a.recordedAt),
        ...(a.reaction ? { reaction: [{ manifestation: [{ text: a.reaction }] }] } : {}),
      });
    }

    for (const v of vitals) {
      const def = VITALS[v.kind];
      entries.push({
        resourceType: "Observation",
        id: v.id,
        status: "final",
        category: [{ coding: [{ system: SYS.obsCategory, code: "vital-signs" }] }],
        code: { coding: [{ system: SYS.loinc, code: def.loinc }] },
        subject: ref(patient.id),
        ...(v.encounterId ? { encounter: ref(v.encounterId) } : {}),
        effectiveDateTime: iso(v.measuredAt),
        valueQuantity: { value: Number(v.value.toString()), unit: v.unit, system: SYS.ucum, code: v.unit },
      });
    }

    for (const o of labs) {
      for (const item of o.items) {
        for (const r of item.results) {
          entries.push({
            resourceType: "Observation",
            id: r.id,
            status: "final",
            category: [{ coding: [{ system: SYS.obsCategory, code: "laboratory" }] }],
            code: { ...(r.analyte.loinc ? { coding: [{ system: SYS.loinc, code: r.analyte.loinc }] } : {}), text: r.analyte.name },
            subject: ref(patient.id),
            ...(o.encounterId ? { encounter: ref(o.encounterId) } : {}),
            effectiveDateTime: iso(o.verifiedAt ?? o.orderedAt),
            identifier: [{ system: `urn:itopmed:${ctx.tenant.slug}:lab-order`, value: o.number }],
            // Lab units are entered by the clinic and not validated as UCUM, so no UCUM system is claimed.
            valueQuantity: { value: Number(r.value.toString()), unit: r.unit },
            ...(r.refLow !== null || r.refHigh !== null
              ? { referenceRange: [{ ...(r.refLow !== null ? { low: { value: Number(r.refLow.toString()), unit: r.unit } } : {}), ...(r.refHigh !== null ? { high: { value: Number(r.refHigh.toString()), unit: r.unit } } : {}) }] }
              : {}),
            interpretation: [{ coding: [{ system: SYS.interpretation, code: r.flag === "LOW" ? "L" : r.flag === "HIGH" ? "H" : "N" }] }],
          });
        }
      }
    }

    await auditClinic(tx, ctx, meta, { action: "emr.exported_fhir", entityType: "Patient", entityId: patient.id, metadata: { resources: entries.length } });
    return {
      resourceType: "Bundle",
      id: crypto.randomUUID(),
      type: "collection",
      timestamp: new Date().toISOString(),
      entry: entries.map((r) => ({ fullUrl: `urn:uuid:${r.id}`, resource: r })),
    };
  });
}
