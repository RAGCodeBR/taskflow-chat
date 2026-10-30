import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { messageLinkParts } from '../message-links';

describe('chat links', () => {
    it('recognizes sent and received HTTP links without consuming punctuation', () => {
        assert.deepEqual(messageLinkParts('Veja https://example.com/a?b=1, depois www.site.com.'), [
            { text: 'Veja ' }, { text: 'https://example.com/a?b=1', href: 'https://example.com/a?b=1' },
            { text: ', depois ' }, { text: 'www.site.com', href: 'https://www.site.com' }, { text: '.' },
        ]);
    });
    it('does not turn scripts or non-web protocols into links', () => {
        assert.deepEqual(messageLinkParts('<script>x</script> javascript:alert(1)'), [{ text: '<script>x</script> javascript:alert(1)' }]);
    });
});
