import { z } from "zod";
const optionalText = (max: number) => z.string().trim().max(max).optional();
export const personalDetailsSchema = z.object({
  firstName: z.string().trim().min(1).max(80).optional(),
  lastName: optionalText(80),
  middleName: optionalText(80),
  birthDate: z.string().refine(value => {
    if (!value) return true;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value && value <= new Date().toISOString().slice(0, 10);
  }).optional(),
  registeredAddress: optionalText(500),
});
export const personalDetailColumns = {
  firstName: "first_name", lastName: "last_name", middleName: "middle_name",
  birthDate: "birth_date", registeredAddress: "registered_address",
} as const;
