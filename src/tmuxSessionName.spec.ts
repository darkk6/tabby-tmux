import { describe, expect, it } from 'vitest'
import {
    buildTmuxAttachCommand,
    quoteShellArgument,
    validateTmuxSessionName,
} from './tmuxSessionName'

describe('validateTmuxSessionName', () => {
    it('accepts a plain name and trims it', () => {
        expect(validateTmuxSessionName('  work-1 ')).toEqual({ name: 'work-1', error: null })
    })

    it.each(['', '   ', null, undefined])('reports %j as empty', (value) => {
        expect(validateTmuxSessionName(value)).toEqual({ name: null, error: 'empty' })
    })

    it.each(['my session', 'a.b', 'a:b', 'tab\there', 'foo;'])(
        'rejects %j because tmux or the shell would mangle it',
        (value) => {
            expect(validateTmuxSessionName(value)).toEqual({ name: null, error: 'invalid' })
        },
    )
})

describe('quoteShellArgument', () => {
    it('leaves plain words untouched', () => {
        expect(quoteShellArgument('default')).toBe('default')
        expect(quoteShellArgument('dev_2-main')).toBe('dev_2-main')
    })

    it('single-quotes anything else and escapes embedded quotes', () => {
        expect(quoteShellArgument('a$b')).toBe(`'a$b'`)
        expect(quoteShellArgument(`it's`)).toBe(`'it'\\''s'`)
        expect(quoteShellArgument('x`y')).toBe("'x`y'")
    })
})

describe('buildTmuxAttachCommand', () => {
    it('matches the historic command for the default name', () => {
        expect(buildTmuxAttachCommand('default')).toBe('tmux -CC new -A -s default')
    })

    it('quotes names with shell metacharacters', () => {
        expect(buildTmuxAttachCommand('a&b')).toBe(`tmux -CC new -A -s 'a&b'`)
    })
})
