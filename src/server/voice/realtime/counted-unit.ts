/**
 * A worker's unit word agreeing with its number, as a Saudi would say it: 3 to 10 take the plural («4 أكياس»),
 * every other count the singular («1 كيس», «20 كيس»). Only units we know both forms of change; any other word is
 * kept exactly as the worker said it.
 */
const FORMS: [singular: string, plural: string, ...also: string[]][] = [
  ["كيس", "أكياس", "اكياس"],
  ["بالة", "بالات"],
  ["طن", "أطنان", "اطنان"],
  ["شوال", "شوالات"],
  ["خيشة", "خياش"],
  ["كرتون", "كراتين"],
  ["برميل", "براميل"],
  ["لتر", "لترات"],
  ["حزمة", "حزم"],
  ["وايت", "وايتات"],
  ["bag", "bags"],
  ["bale", "bales"],
  ["ton", "tons"],
  ["sack", "sacks"],
  ["liter", "liters"],
  ["litre", "litres"],
];

export function countedUnit(count: number, unit: string): string {
  const forms = FORMS.find((entry) => entry.includes(unit.trim()));
  if (!forms) return unit;
  const latin = /^[a-z]/i.test(forms[0]);
  const plural = latin ? count !== 1 : Number.isInteger(count) && count >= 3 && count <= 10;
  return plural ? forms[1] : forms[0];
}
