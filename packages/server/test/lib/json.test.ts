import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_COLLECTION_SIZE, safeJsonParse } from '../../src/lib/json.js'

describe('MAX_COLLECTION_SIZE', () => {
  it('is exactly 1000', () => {
    assert.equal(MAX_COLLECTION_SIZE, 1000)
  })
})

describe('safeJsonParse', () => {
  // --- primitive types ---

  it('parses a string primitive', () => {
    assert.equal(safeJsonParse('"hello"', 1), 'hello')
  })

  it('parses a number primitive', () => {
    assert.equal(safeJsonParse('42', 1), 42)
  })

  it('parses a boolean primitive', () => {
    assert.equal(safeJsonParse('true', 1), true)
    assert.equal(safeJsonParse('false', 1), false)
  })

  it('parses null', () => {
    assert.equal(safeJsonParse('null', 1), null)
  })

  it('handles primitives at maxDepth 0', () => {
    // Primitives never increase depth, so depth 0 is fine
    assert.equal(safeJsonParse('"ok"', 0), 'ok')
    assert.equal(safeJsonParse('123', 0), 123)
    assert.equal(safeJsonParse('null', 0), null)
  })

  // --- valid depth ---

  it('parses a flat object within depth limit', () => {
    const raw = JSON.stringify({ a: 1, b: 2 })
    assert.deepEqual(safeJsonParse(raw, 2), { a: 1, b: 2 })
  })

  it('parses a flat array within depth limit', () => {
    const raw = JSON.stringify([1, 2, 3])
    assert.deepEqual(safeJsonParse(raw, 2), [1, 2, 3])
  })

  it('parses nested objects within depth limit', () => {
    const raw = JSON.stringify({ a: { b: { c: 1 } } })
    // depth 0: root object, depth 1: {b:…}, depth 2: {c:1}, depth 3: 1 (primitive)
    assert.deepEqual(safeJsonParse(raw, 3), { a: { b: { c: 1 } } })
  })

  it('parses nested arrays within depth limit', () => {
    const raw = JSON.stringify([[[1]]])
    assert.deepEqual(safeJsonParse(raw, 3), [[[1]]])
  })

  it('parses mixed nested arrays and objects', () => {
    const data = { list: [{ id: 1 }, { id: 2 }] }
    const raw = JSON.stringify(data)
    // depth 0: root obj, depth 1: array, depth 2: {id:…}, depth 3: number
    assert.deepEqual(safeJsonParse(raw, 3), data)
  })

  // --- empty collections ---

  it('parses empty object at depth 0', () => {
    assert.deepEqual(safeJsonParse('{}', 0), {})
  })

  it('parses empty array at depth 0', () => {
    assert.deepEqual(safeJsonParse('[]', 0), [])
  })

  it('parses nested empty objects within limit', () => {
    const raw = JSON.stringify({ a: {} })
    assert.deepEqual(safeJsonParse(raw, 2), { a: {} })
  })

  it('parses nested empty arrays within limit', () => {
    const raw = JSON.stringify([[], []])
    assert.deepEqual(safeJsonParse(raw, 2), [[], []])
  })

  // --- depth exceeded ---

  it('throws when object nesting exceeds maxDepth', () => {
    // { a: { b: 1 } } needs depth 2 for the value; at maxDepth 1 the inner obj is at depth 1 and its value at depth 2 > 1
    const raw = JSON.stringify({ a: { b: 1 } })
    assert.throws(() => safeJsonParse(raw, 1), {
      message: 'JSON nesting depth exceeded',
    })
  })

  it('throws when array nesting exceeds maxDepth', () => {
    const raw = JSON.stringify([[1]])
    assert.throws(() => safeJsonParse(raw, 1), {
      message: 'JSON nesting depth exceeded',
    })
  })

  it('throws for deeply nested objects beyond limit', () => {
    // Build { a: { a: { a: ... } } } with 10 levels
    let obj: unknown = 'leaf'
    for (let i = 0; i < 10; i++) obj = { a: obj }
    const raw = JSON.stringify(obj)
    assert.throws(() => safeJsonParse(raw, 5), {
      message: 'JSON nesting depth exceeded',
    })
  })

  it('throws for deeply nested arrays beyond limit', () => {
    // Build [[[...[1]...]]] with 10 levels
    let arr: unknown = 1
    for (let i = 0; i < 10; i++) arr = [arr]
    const raw = JSON.stringify(arr)
    assert.throws(() => safeJsonParse(raw, 5), {
      message: 'JSON nesting depth exceeded',
    })
  })

  it('throws for mixed nesting exceeding depth', () => {
    // { a: [{ b: [1] }] } — depth chain: 0(obj) -> 1(arr) -> 2(obj) -> 3(arr) -> 4(num)
    const raw = JSON.stringify({ a: [{ b: [1] }] })
    assert.throws(() => safeJsonParse(raw, 3), {
      message: 'JSON nesting depth exceeded',
    })
  })

  // --- collection size exceeded ---

  it('throws when array length exceeds MAX_COLLECTION_SIZE', () => {
    const bigArr = new Array(1001).fill(0)
    const raw = JSON.stringify(bigArr)
    assert.throws(() => safeJsonParse(raw, 2), {
      message: 'JSON collection size exceeded',
    })
  })

  it('does not throw when array length equals MAX_COLLECTION_SIZE', () => {
    const arr = new Array(1000).fill(0)
    const raw = JSON.stringify(arr)
    assert.doesNotThrow(() => safeJsonParse(raw, 2))
  })

  it('throws when object has more than MAX_COLLECTION_SIZE keys', () => {
    const obj: Record<string, number> = {}
    for (let i = 0; i < 1001; i++) obj[`k${i}`] = i
    const raw = JSON.stringify(obj)
    assert.throws(() => safeJsonParse(raw, 2), {
      message: 'JSON collection size exceeded',
    })
  })

  it('does not throw when object has exactly MAX_COLLECTION_SIZE keys', () => {
    const obj: Record<string, number> = {}
    for (let i = 0; i < 1000; i++) obj[`k${i}`] = i
    const raw = JSON.stringify(obj)
    assert.doesNotThrow(() => safeJsonParse(raw, 2))
  })

  it('throws when a nested array exceeds collection size', () => {
    const data = { items: new Array(1001).fill(0) }
    const raw = JSON.stringify(data)
    assert.throws(() => safeJsonParse(raw, 3), {
      message: 'JSON collection size exceeded',
    })
  })

  // --- invalid JSON ---

  it('throws SyntaxError for invalid JSON', () => {
    assert.throws(() => safeJsonParse('{bad}', 5), SyntaxError)
  })

  it('throws SyntaxError for empty string', () => {
    assert.throws(() => safeJsonParse('', 5), SyntaxError)
  })

  it('throws SyntaxError for trailing comma', () => {
    assert.throws(() => safeJsonParse('[1,2,]', 5), SyntaxError)
  })
})
