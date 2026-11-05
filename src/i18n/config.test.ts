import { expect, it } from 'vitest';
import { searchForLocale } from './config';

it('moves a return path to the new language', () => {
  expect(searchForLocale('?next=%2Fen%2Fstart', 'en', 'ar')).toBe('?next=%2Far%2Fstart');
});
it('leaves other queries unchanged', () => {
  expect(searchForLocale('', 'en', 'ar')).toBe('');
  expect(searchForLocale('?tab=all', 'en', 'ar')).toBe('?tab=all');
  expect(searchForLocale('?next=%2Fentry', 'en', 'ar')).toBe('?next=%2Fentry');
});
