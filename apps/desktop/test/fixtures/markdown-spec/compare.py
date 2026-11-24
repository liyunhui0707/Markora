"""Compare visible structure, text and emphasis without creating a live HTML document."""
import json
import sys
from html.parser import HTMLParser
from itertools import groupby

class Semantics(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.events = []
        self.marks = []
        self.spans = []
        self.list_depth = 0
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'span':
            self.spans.append('data-document-link' in attrs)
            if not self.spans[-1]:
                return
            tag = 'a'
        if tag in ('section', 'div', 'tbody', 'thead'):
            return
        tag = 's' if tag in ('del', 'strike') else tag
        if tag in ('strong', 'em', 'a', 's', 'code'):
            self.marks.append(tag)
            return
        if tag in ('li', 'th', 'td'):
            self.list_depth += 1
        if tag == 'p' and self.list_depth:
            self.events.append(('boundary', ' '))
        else:
            self.events.append(('open', tag))
    def handle_endtag(self, tag):
        if tag == 'span':
            if not self.spans or not self.spans.pop():
                return
            tag = 'a'
        if tag in ('section', 'div', 'tbody', 'thead', 'br', 'img', 'hr', 'input'):
            return
        tag = 's' if tag in ('del', 'strike') else tag
        if tag in self.marks:
            self.marks.remove(tag)
            return
        if tag in ('li', 'th', 'td'):
            self.list_depth = max(0, self.list_depth - 1)
        if tag == 'p' and self.list_depth:
            self.events.append(('boundary', ' '))
        else:
            self.events.append(('close', 's' if tag in ('del', 'strike') else tag))
    def handle_data(self, data):
        self.events.append(('text' + ','.join(sorted(self.marks)), data))
    def result(self):
        # Source-mode margins, soft wraps and schema-required list paragraphs
        # differ from HTML whitespace. Keep word boundaries within text runs.
        events = [('text' if key == 'boundary' else key, val) for key, val in self.events if key != 'close' or val != 'a']
        out = []
        for key, rows in groupby(events, lambda row: row[0]):
            values = [row[1] for row in rows]
            if key.startswith('text'):
                words = ' '.join(''.join(values).split())
                if words:
                    out.append((key, words))
            else:
                out.extend((key, val) for val in values)
        # Ignore the empty paragraph reserved for the insertion caret.
        return [row for i,row in enumerate(out) if not (row == ('open', 'p') and out[i+1:i+2] == [('close', 'p')] or row == ('close', 'p') and i and out[i-1] == ('open', 'p'))]

def normalize(html):
    parser = Semantics()
    parser.feed(html)
    return parser.result()
for entry in sys.stdin:
    suite, case, official, actual = json.loads(entry)
    if normalize(official) != normalize(actual):
        print(json.dumps([suite, case, official, actual], ensure_ascii=False))
