import { expect, mock, test } from 'claude-code/testing'

const LONG = Array.from({ length: 150 }, (_, i) => `word${i}`).join(' ')
const composer = { origin: { kind: 'composer' }, wait: false } as const

const submit = ($: any, text: string) => $.prompt.submit({ text, ...composer } as any)

test('a long prompt gets the structuring instructions; a short one does not', async ($, on) => {
  mock.store(on)
  on('prompt.submit', (_, e) => ({ text: e.text, context: e.context }))

  const short = await submit($, 'fix the typo in the README')
  expect(short.context ?? []).toEqual([])

  const long = await submit($, LONG)
  expect(long.text).toBe(LONG)
  expect((long.context ?? []).join('')).toContain('Definition of done')
})

test('raw: sends as is, structure: forces a short prompt', async ($, on) => {
  mock.store(on)
  on('prompt.submit', (_, e) => ({ text: e.text, context: e.context }))

  const raw = await submit($, `raw: ${LONG}`)
  expect(raw.text).toBe(LONG)
  expect(raw.context ?? []).toEqual([])

  const forced = await submit($, 'structure: rename the flap module')
  expect(forced.text).toBe('rename the flap module')
  expect((forced.context ?? []).join('')).toContain('AskUserQuestion')
})

test('the ready tool fills the box without sending; the reviewed prompt then passes through', async ($, on) => {
  mock.store(on)
  const filled: string[] = []
  on('prompt.fill', (_, e) => {
    filled.push(e.text)
    return { isFilled: true, text: e.text, cursor: 0 } as any
  })
  on('prompt.submit', (_, e) => ({ text: e.text, context: e.context }))

  await submit($, LONG)
  const prompt = '## Job\nDo X.\n## Why\nY.\n## Boundaries\nZ.\n## Definition of done\nTests pass.'
  const ran = await $.tool.call({ tool: 'mcp__brain-dump-structurer__ready', prompt } as any)
  expect(ran.deny).toBeUndefined()
  expect(typeof ran.result).toBe('string')
  expect(filled).toEqual([prompt])

  const reviewed = await submit($, prompt)
  expect(reviewed.context ?? []).toEqual([])
})

test('/brain-dump off turns detection off', async ($, on) => {
  mock.store(on)
  on('prompt.submit', (_, e) => ({ text: e.text, context: e.context }))

  const out = await $.command.run({ command: 'brain-dump', args: 'off' } as any)
  expect(out.text).toContain('off')
  const long = await submit($, LONG)
  expect(long.context ?? []).toEqual([])
})

test('a structuring that never reached the ready tool stops tagging prompts after two turns', async ($, on) => {
  mock.store(on)
  on('prompt.submit', (_, e) => ({ text: e.text, context: e.context }))
  on('turn.complete', (_, e) => ({ text: e.answer }))

  await submit($, LONG)
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as any)
  const answer = await submit($, 'option A please')
  expect((answer.context ?? []).join('')).toContain('continues the brain-dump')
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as any)
  const later = await submit($, 'an unrelated short question')
  expect(later.context ?? []).toEqual([])
})

const BAND = {
  plugin: 'brain-dump-structurer',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 80, scroll: { offset: 0, bodyRows: 4 } },
} as const

const type = ($: any, text: string) =>
  $.prompt.edit({ origin: { kind: 'composer' }, text: '', cursor: 0, start: 0, end: 0, inputText: text } as any)

test('a long draft shows the orange line before Enter; Ignore sends it as is', async ($, on) => {
  mock.store(on)
  on('prompt.edit', (_, e) => ({ text: e.inputText, cursor: e.inputText.length }) as any)
  // Stands for the engine's own (empty) band.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })
  on('prompt.submit', (_, e) => ({ text: e.text, context: e.context }))

  await type($, 'a short note')
  for (const surface of ['terminal', 'desktop'] as const) {
    const quiet = await $.ui.mount({ ...BAND, surface } as any)
    expect(await quiet.find({ type: 'Text', text: /Brain dump detected/ })).toBeUndefined()
    await quiet.unmount()
  }

  await type($, LONG)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' } as any)
  expect((await ui.find({ type: 'Text', text: /Brain dump detected/ }))?.text).toContain('150 words')
  await ui.press({ key: 'ignore' } as any)
  expect(await ui.find({ type: 'Text', text: /Brain dump ignored/ })).toBeDefined()
  await ui.unmount()

  const sent = await submit($, LONG)
  expect(sent.context ?? []).toEqual([])
})
