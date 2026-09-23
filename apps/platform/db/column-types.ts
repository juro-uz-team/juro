import { customType } from "drizzle-orm/pg-core";

// Retain the persisted 0/1 representation shared with parameterized application queries.
export const booleanInteger = customType<{ data: boolean; driverData: number }>({
  dataType: () => "bigint",
  toDriver: value => value ? 1 : 0,
  fromDriver: value => Number(value) === 1,
});
