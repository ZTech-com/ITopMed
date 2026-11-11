-- Walk-in patients join the queue; they do not occupy a timed slot, so they are
-- excluded from the double-booking constraint (booked slots stay race-proof).
ALTER TABLE "Appointment" DROP CONSTRAINT "Appointment_no_overlap";
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_no_overlap"
  EXCLUDE USING gist ("doctorProfileId" WITH =, tsrange("startsAt", "endsAt") WITH &&)
  WHERE (status NOT IN ('CANCELLED', 'NO_SHOW') AND source <> 'WALK_IN');
