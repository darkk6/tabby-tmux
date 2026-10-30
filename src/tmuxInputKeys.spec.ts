import { describe, expect, it } from 'vitest'
import { tmuxKeyNameForSequence } from './tmuxInputKeys'

const seq = (s: string) => Buffer.from(s, 'latin1')

describe('tmuxKeyNameForSequence', () => {
    it.each<[string, string]>([
        ['\x1b[F', 'End'],
        ['\x1bOF', 'End'],
        ['\x1b[4~', 'End'],
        ['\x1b[8~', 'End'],
        ['\x1b[H', 'Home'],
        ['\x1bOH', 'Home'],
        ['\x1b[1~', 'Home'],
        ['\x1b[7~', 'Home'],
    ])('maps %j → %s', (input, expected) => {
        expect(tmuxKeyNameForSequence(seq(input))).toBe(expected)
    })

    it.each<[string, string]>([
        ['\x1b[1;2F', 'S-End'],
        ['\x1b[1;3F', 'M-End'],
        ['\x1b[1;4H', 'M-S-Home'],
        ['\x1b[1;5F', 'C-End'],
        ['\x1b[1;6H', 'C-S-Home'],
        ['\x1b[1;7F', 'C-M-End'],
        ['\x1b[1;8F', 'C-M-S-End'],
        ['\x1b[4;5~', 'C-End'],
        ['\x1b[1;2~', 'S-Home'],
    ])('maps modified %j → %s', (input, expected) => {
        expect(tmuxKeyNameForSequence(seq(input))).toBe(expected)
    })

    it.each<string>([
        'a',
        'abc',
        '\x1b',
        '\x1b[',
        '\x1b[A', // Up: xterm and tmux agree, keep literal
        '\x1bOA',
        '\x1b[3~', // Delete
        '\x1b[5~', // PgUp
        '\x1b[200~', // bracketed paste start
        '\x1b[201~',
        '\x1b[<0;10;20M', // SGR mouse report
        '\x1b[1;9F', // Meta modifier: no tmux name
        '\x1b[1;0F',
        '\x1b[1;F',
        '\x1b[F\x1b[F', // two keys coalesced
        'x\x1b[F',
        '\x1b[Fx',
        '\x1bf', // Alt-f
    ])('leaves %j literal', (input) => {
        expect(tmuxKeyNameForSequence(seq(input))).toBeNull()
    })

    it('leaves an empty buffer literal', () => {
        expect(tmuxKeyNameForSequence(Buffer.alloc(0))).toBeNull()
    })
})
