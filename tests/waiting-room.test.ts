import { describe, expect, it } from "vitest";
import { addStaffMember, listBranches, listStaff } from "@/server/clinic/admin";
import { saveDoctorProfile } from "@/server/clinic/doctors";
import { importPriceList } from "@/server/clinic/price-list";
import { listServices } from "@/server/clinic/resources";
import { startVisit } from "@/server/emr/record";
import { boardForToken, callNextPatient, createScreen, revokeScreen, listScreens, saveCabinet, shortName } from "@/server/queue/board";
import { deskCheckIn } from "@/server/reception/desk";
import { META, PASSWORD, clinicContext, clinicWithOwner, platformActor, uniq } from "./helpers/fixtures";

async function staff(o: Awaited<ReturnType<typeof clinicWithOwner>>, roleKeys: string[]) {
  const login = uniq("s");
  await addStaffMember(o.ctx, { fullName: `Synthetic ${roleKeys.join(" ")}`, username: login, roleKeys, password: PASSWORD }, META);
  const m = (await listStaff(o.ctx)).members.find((x) => x.user.username === login)!;
  return { membershipId: m.id, ctx: await clinicContext(login, o.slug) };
}

describe("waiting room", () => {
  it("short names only on the screen", () => {
    expect(shortName({ lastName: "Karimova", firstName: "Dilnoza" })).toBe("Dilnoza K.");
  });

  it("next patient is called in queue order; the screen shows number, short name and cabinet; revoked links stop", async () => {
    const o = await clinicWithOwner(await platformActor());
    const [branch] = await listBranches(o.ctx);
    await importPriceList(o.ctx, { text: "Kardiolog ko'ruvi 100 ming" }, META);
    const [service] = await listServices(o.ctx);
    const desk = await staff(o, ["receptionist", "cashier"]);
    const doctor = await staff(o, ["doctor"]);
    const profileId = await saveDoctorProfile(o.ctx, doctor.membershipId, { specialty: "cardiology", defaultSlotMinutes: 20, acceptsOnlineBooking: false }, META);
    await saveCabinet(doctor.ctx, { cabinet: "3-xona" }, META);

    const add = async (firstName: string, lastName: string, year: string) => {
      const r = await deskCheckIn(desk.ctx, { lastName, firstName, birthDate: year, confirmNotDuplicate: "on", sex: "MALE", doctorProfileId: profileId, branchId: branch!.id, serviceIds: [service!.id], payMode: "debt" }, META);
      if (!r.ok) throw new Error("duplicate");
      return r;
    };
    const first = await add("Birinchi", "Sintetikov", "1960");
    const second = await add("Ikkinchi", "Namunaev", "1975");

    const { token } = await createScreen(o.ctx, { branchId: branch!.id, name: "Synthetic hall", voice: true }, META);
    let board = (await boardForToken(token))!;
    expect(board.calls).toHaveLength(0);
    expect(board.waiting.map((w) => w.number)).toEqual([1, 2]);

    // A receptionist cannot press the doctor's button; the doctor can.
    await expect(callNextPatient(o.ctx, META)).rejects.toThrow();
    expect(await callNextPatient(doctor.ctx, META)).toMatchObject({ appointmentId: first.appointmentId, queueNumber: 1 });
    board = (await boardForToken(token))!;
    expect(board.calls[0]).toMatchObject({ number: 1, name: "Birinchi S.", cabinet: "3-xona", state: "called", calls: 1 });
    expect(JSON.stringify(board)).not.toContain("1960");

    // Recall repeats the same patient; the next call moves on.
    expect(await callNextPatient(doctor.ctx, META, { recall: true })).toMatchObject({ queueNumber: 1 });
    expect((await boardForToken(token))!.calls[0]!.calls).toBe(2);
    await startVisit(doctor.ctx, first.appointmentId, META);
    expect(await callNextPatient(doctor.ctx, META)).toMatchObject({ appointmentId: second.appointmentId, queueNumber: 2 });
    board = (await boardForToken(token))!;
    expect(board.calls.map((c) => [c.number, c.state])).toEqual([
      [2, "called"],
      [1, "inVisit"],
    ]);
    expect(await callNextPatient(doctor.ctx, META)).toBeNull();

    const [screen] = await listScreens(o.ctx);
    await revokeScreen(o.ctx, screen!.id, META);
    expect(await boardForToken(token)).toBeNull();
    expect(await boardForToken("not-a-token")).toBeNull();
  });
});
