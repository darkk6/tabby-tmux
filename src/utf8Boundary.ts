/**
 * UTF-8 boundary helpers for pane output.
 *
 * tmux forwards a pane's raw bytes in %output lines and a PTY/SSH packet or
 * an %output line may end in the middle of a multi-byte character. Tabby
 * decodes every Buffer it is handed on its own, so such a split renders as
 * U+FFFD replacement characters unless the incomplete tail is held back and
 * joined with the bytes that complete it.
 */

/** True for a UTF-8 continuation byte (10xxxxxx). */
export function isUtf8Continuation(byte: number): boolean {
    return (byte & 0xc0) === 0x80
}

/** Number of continuation bytes at the start of `data`, which no lead byte claims. */
export function leadingContinuationBytes(data: Buffer): number {
    let n = 0
    while (n < data.length && isUtf8Continuation(data[n])) n++
    return n
}

/** Sequence length announced by a UTF-8 lead byte, or 0 when `byte` is not one. */
function sequenceLength(byte: number): number {
    if (byte >= 0xc2 && byte <= 0xdf) return 2
    if (byte >= 0xe0 && byte <= 0xef) return 3
    if (byte >= 0xf0 && byte <= 0xf4) return 4
    return 0
}

/**
 * Offset where an incomplete trailing UTF-8 sequence starts, or `data.length`
 * when the buffer ends on a complete character. Bytes that are not a valid
 * prefix of any sequence are not held back; the decoder flags them.
 */
export function incompleteUtf8TailStart(data: Buffer): number {
    const len = data.length
    for (let back = 1; back <= 3 && back <= len; back++) {
        const byte = data[len - back]
        if (byte < 0x80) return len
        if (isUtf8Continuation(byte)) continue
        const need = sequenceLength(byte)
        return need > back ? len - back : len
    }
    return len
}
