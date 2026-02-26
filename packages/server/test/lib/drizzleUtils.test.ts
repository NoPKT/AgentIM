import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { getAffectedRowCount } from '../../src/lib/drizzleUtils.js'

describe('getAffectedRowCount', () => {
  it('returns rowCount when present', () => {
    assert.equal(getAffectedRowCount({ rowCount: 5 }), 5)
  })

  it('returns rowCount of 1', () => {
    assert.equal(getAffectedRowCount({ rowCount: 1 }), 1)
  })

  it('returns rowCount of 0', () => {
    assert.equal(getAffectedRowCount({ rowCount: 0 }), 0)
  })

  it('returns large rowCount values', () => {
    assert.equal(getAffectedRowCount({ rowCount: 999999 }), 999999)
  })

  it('returns 0 when rowCount is undefined', () => {
    assert.equal(getAffectedRowCount({ rowCount: undefined }), 0)
  })

  it('throws TypeError when result is null', () => {
    assert.throws(() => getAffectedRowCount(null), TypeError)
  })

  it('throws TypeError when result is undefined', () => {
    assert.throws(() => getAffectedRowCount(undefined), TypeError)
  })

  it('returns 0 when result is an empty object', () => {
    assert.equal(getAffectedRowCount({}), 0)
  })

  it('returns 0 when result has unrelated properties only', () => {
    assert.equal(getAffectedRowCount({ command: 'INSERT', oid: 0 }), 0)
  })

  it('returns rowCount even when other properties exist', () => {
    assert.equal(getAffectedRowCount({ rowCount: 3, command: 'UPDATE', oid: 0 }), 3)
  })
})
