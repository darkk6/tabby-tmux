import { describe, expect, it } from 'vitest'
import {
    incompleteUtf8TailStart,
    isUtf8Continuation,
    leadingContinuationBytes,
} from './utf8Boundary'

const bytes = (...values: number[]) => Buffer.from(values)

describe('isUtf8Continuation', () => {
    it('matches only 10xxxxxx bytes', () => {
        expect(isUtf8Continuation(0x80)).toBe(true)
        expect(isUtf8Continuation(0xbf)).toBe(true)
        expect(isUtf8Continuation(0x7f)).toBe(false)
        expect(isUtf8Continuation(0xc2)).toBe(false)
        expect(isUtf8Continuation(0xe8)).toBe(false)
    })
})

describe('leadingContinuationBytes', () => {
    it('counts orphaned continuation bytes at the start only', () => {
        expect(leadingContinuationBytes(bytes(0xa8, 0xad, 0x41))).toBe(2)
        expect(leadingContinuationBytes(bytes(0x41, 0xa8))).toBe(0)
        expect(leadingContinuationBytes(Buffer.from('設'))).toBe(0)
        expect(leadingContinuationBytes(Buffer.alloc(0))).toBe(0)
    })
})

describe('incompleteUtf8TailStart', () => {
    it('leaves complete text alone', () => {
        for (const text of ['', 'ascii', '設定', 'a設', '🚀', '󰀁 🚀', 'é']) {
            const data = Buffer.from(text)
            expect(incompleteUtf8TailStart(data)).toBe(data.length)
        }
    })

    it('finds a 3-byte character cut after its first or second byte', () => {
        const cjk = Buffer.from('設') // e8 a8 ad
        const afterFirst = Buffer.concat([Buffer.from('RBAC '), cjk.subarray(0, 1)])
        expect(incompleteUtf8TailStart(afterFirst)).toBe(afterFirst.length - 1)
        const afterSecond = Buffer.concat([Buffer.from('RBAC '), cjk.subarray(0, 2)])
        expect(incompleteUtf8TailStart(afterSecond)).toBe(afterSecond.length - 2)
    })

    it('finds a 2-byte and a 4-byte character cut short', () => {
        const latin = Buffer.from('é') // c3 a9
        expect(incompleteUtf8TailStart(latin.subarray(0, 1))).toBe(0)
        const emoji = Buffer.from('🚀') // f0 9f 9a 80
        expect(incompleteUtf8TailStart(emoji.subarray(0, 1))).toBe(0)
        expect(incompleteUtf8TailStart(emoji.subarray(0, 2))).toBe(0)
        expect(incompleteUtf8TailStart(emoji.subarray(0, 3))).toBe(0)
    })

    it('does not hold back bytes that cannot start a sequence', () => {
        // Overlong / out-of-range lead bytes and a lone continuation byte are
        // invalid whatever follows; leave them to the decoder.
        expect(incompleteUtf8TailStart(bytes(0x41, 0xc0))).toBe(2)
        expect(incompleteUtf8TailStart(bytes(0x41, 0xf5))).toBe(2)
        expect(incompleteUtf8TailStart(bytes(0x41, 0xff))).toBe(2)
        expect(incompleteUtf8TailStart(bytes(0x41, 0xa8))).toBe(2)
    })

    it('does not look past three trailing bytes', () => {
        // A lead byte four bytes back is complete (4-byte sequence) or invalid
        // (3-byte lead followed by too many continuations); either way complete.
        expect(incompleteUtf8TailStart(bytes(0xe8, 0xa8, 0xad, 0x80))).toBe(4)
    })
})
