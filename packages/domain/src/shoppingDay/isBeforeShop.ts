// Pure planner-shading predicate (issue #629). NO I/O, no clock (CLAUDE.md
// Rule 1): both dates are supplied by the caller.
//
// This is the whole reason the shop date is recorded at all, beyond the ping: a
// day BEFORE the shop can only be cooked from food already in the house, which is
// meal-planning information. The planner shades those days; days from the shop
// onward are unshaded.
//
// The shop day itself is NOT "before the shop" — you can plan around what gets
// bought that morning/afternoon. With no shop set nothing is shaded: an unmarked
// week makes no claim about provisioning, so shading every day would be a lie.
//
// Both arguments are `YYYY-MM-DD` calendar dates, which compare correctly as
// plain strings (fixed-width, big-endian), so month and year boundaries need no
// arithmetic.
export function isBeforeShop(day: string, shopDate: string | null): boolean {
  if (!shopDate) return false;
  return day < shopDate;
}
