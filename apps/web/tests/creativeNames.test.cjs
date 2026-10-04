const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../../packages/shared/src/creativeNames.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const context = { exports: {} };
vm.runInNewContext(compiled, context);
const { assignCreativeName, creativeNameValidationError } = context.exports;
const values = (assignments) => ({ printImages: [{ id: 'a' }, { id: 'b' }], creativeNameAssignments: assignments });

test('new and partially named artwork block exports and submission', () => {
  assert(creativeNameValidationError(values({})));
  assert(creativeNameValidationError(values({ Creative1: 'a' })));
  assert(creativeNameValidationError({ printImages: [] }));
});
test('selecting an occupied name warns without changing either assignment', () => {
  const original = { Creative1: 'a', Creative2: 'b' };
  const result = assignCreativeName(original, ['a', 'b'], 'b', 'Creative1');
  assert.match(result.error, /already chosen.*Clear/);
  assert.equal(result.assignments, original);
  assert.equal(original.Creative2, 'b');
});
test('clear then choose permits reassignment and leaves the other artwork unnamed', () => {
  const cleared = assignCreativeName({ Creative1: 'a', Creative2: 'b' }, ['a', 'b'], 'a', '');
  assert.equal(cleared.assignments.Creative1, undefined);
  assert(creativeNameValidationError(values(cleared.assignments)));
  const selected = assignCreativeName(cleared.assignments, ['a', 'b'], 'b', 'Creative1');
  assert.equal(selected.error, '');
  assert.equal(selected.assignments.Creative1, 'b');
  assert.equal(selected.assignments.Creative2, undefined);
  const finished = assignCreativeName(selected.assignments, ['a', 'b'], 'a', 'Creative2');
  assert.equal(creativeNameValidationError(values(finished.assignments)), '');
});
test('clear survives saving and reload without auto-assignment', () => {
  const result = assignCreativeName({ Creative1: 'a', Creative2: 'b' }, ['a', 'b'], 'a', '');
  const reloaded = JSON.parse(JSON.stringify(values(result.assignments)));
  assert(creativeNameValidationError(reloaded));
  assert.equal(reloaded.creativeNameAssignments.Creative1, undefined);
});
test('deleted files release names and saved higher numbers remain valid', () => {
  const result = assignCreativeName({ Creative1: 'deleted', Creative4: 'b' }, ['a', 'b'], 'a', 'Creative1');
  assert.equal(result.error, '');
  assert.equal(creativeNameValidationError(values(result.assignments)), '');
});
test('invalid and duplicate image assignments are blocked', () => {
  for (const assignments of [{ Creative1: 'a', Creative2: 'a' }, { Creative0: 'a', Creative2: 'b' }, { creative1: 'a', Creative2: 'b' }, { Creative9007199254740992: 'a', Creative2: 'b' }]) {
    assert(creativeNameValidationError(values(assignments)));
  }
});
test('changing or reselecting a name never mutates artwork records', () => {
  const campaign = values({ Creative1: 'a', Creative2: 'b' });
  const before = JSON.stringify(campaign);
  const result = assignCreativeName(campaign.creativeNameAssignments, ['a', 'b'], 'a', 'Creative1');
  assert.equal(creativeNameValidationError(values(result.assignments)), '');
  assert.equal(JSON.stringify(campaign), before);
});
