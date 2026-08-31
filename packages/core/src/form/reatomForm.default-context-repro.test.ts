// ⚠️ Run this file in isolation:
//   pnpm vitest run src/form/reatomForm.default-context-repro.test.ts
//
// This suite deliberately imports `test`/`expect` from 'vitest' directly and
// `reatomForm`/`reatomField`/`context` from '../' — NOT from this package's
// own `./src/test.ts` harness. That harness calls `clearStack()` at module
// scope and wraps every test body in `context.start(...)`, which is a
// stricter execution mode than how `@reatom/core` actually runs in a real
// app: nothing in a browser bootstrap calls `clearStack()` — apps just import
// `@reatom/core` and use the default global context it installs (see
// testing.md: "Reatom pushes a default global context when @reatom/core is
// imported. In that default mode, atom reads/writes in tests work
// directly.").
//
// Because this repo's vitest.config.ts sets `isolate: false` (all test files
// share one module registry/process), running this file together with any
// other spec that imports `./src/test.ts` will have already called
// `clearStack()` globally by the time this file runs, and every test below
// will fail with "missing async stack" instead of demonstrating the actual
// bug. Run it alone.
import { beforeEach, describe, expect, test } from 'vitest'
import { z } from 'zod'

import { context, reatomField, reatomForm, wrap } from '../'

beforeEach(() => {
  context.reset()
})

// Real notification is scheduled via `queueMicrotask` (see
// `core/queues.ts#_enqueue`); this drains a few turns plus one macrotask to
// rule out "just didn't wait long enough".
const settle = async () => {
  await Promise.resolve()
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('reatomForm loses a field error after a rejected submit() (default global context)', () => {
  test('baseline — single field: change() then a rejected submit() keeps the error', async () => {
    const form = reatomForm(
      { password: reatomField('', { name: 'single.password', validate: z.string().min(8, 'too short') }) },
      { name: 'singleFieldForm', onSubmit: async () => {} },
    )
    // A live subscription matches a mounted UI component (e.g. reatomComponent).
    const off = form.fields.password.validation.subscribe(() => {})

    form.fields.password.change('short') // normal user typing
    await wrap(form.submit()).catch(() => {})
    await settle()

    expect(form.fields.password.validation.errors().map((e) => e.message)).toEqual(['too short'])
    off()
  })

  test('BUG — two fields, zod validate: the second field makes the error vanish', async () => {
    const form = reatomForm(
      {
        // Never touched; keeps its valid initial value.
        email: reatomField('athlete@example.com', { name: 'two.email', validate: z.email() }),
        password: reatomField('', { name: 'two.password', validate: z.string().min(8, 'too short') }),
      },
      { validateOnChange: false, keepErrorOnChange: false, name: 'twoFieldForm', onSubmit: async () => {} },
    )
    const offEmail = form.fields.email.validation.subscribe(() => {})
    const offPassword = form.fields.password.validation.subscribe(() => {})

    form.fields.password.change('short')
    await wrap(form.submit()).catch(() => {})
    await settle()

    // Expected: same result as the single-field baseline above.
    // Actual: `[]` — the error was computed correctly during submit (this can
    // be shown by calling `form.validation.triggerSchemaValidation()`-style
    // internals directly), but is gone by the time anything reads it back.
    expect(form.fields.password.validation.errors().map((e) => e.message)).toEqual(['too short'])

    offEmail()
    offPassword()
  })

  test('BUG — same as above, with a per-field function validate instead of a Standard Schema', async () => {
    const form = reatomForm(
      {
        name: reatomField('Roman', {
          name: 'two2.name',
          validate: ({ value }: { value: string }) => (value.length > 0 ? undefined : 'required'),
        }),
        email: reatomField('', {
          name: 'two2.email',
          validate: ({ value }: { value: string }) => (value.includes('@') ? undefined : 'invalid email'),
        }),
      },
      { validateOnChange: false, keepErrorOnChange: false, name: 'twoFieldFormFn', onSubmit: async () => {} },
    )
    const offName = form.fields.name.validation.subscribe(() => {})
    const offEmail = form.fields.email.validation.subscribe(() => {})

    form.fields.email.change('not-an-address')
    await wrap(form.submit()).catch(() => {})
    await settle()

    expect(form.fields.email.validation.errors().map((e) => e.message)).toEqual(['invalid email'])

    offName()
    offEmail()
  })
})
