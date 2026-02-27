import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { stripHtml, sanitizeText, sanitizeContent } from '../../src/lib/sanitize.js'

describe('stripHtml', () => {
  it('returns empty string for empty input', () => {
    assert.equal(stripHtml(''), '')
  })

  it('strips basic HTML tags', () => {
    assert.equal(stripHtml('<b>bold</b>'), 'bold')
    assert.equal(stripHtml('<p>paragraph</p>'), 'paragraph')
  })

  it('strips nested HTML tags', () => {
    assert.equal(stripHtml('<div><span>text</span></div>'), 'text')
  })

  it('decodes HTML entities before stripping', () => {
    assert.equal(stripHtml('&lt;script&gt;alert(1)&lt;/script&gt;'), 'alert(1)')
    assert.equal(stripHtml('a &amp; b'), 'a & b')
    assert.equal(stripHtml('&quot;quoted&quot;'), '"quoted"')
    assert.equal(stripHtml('it&#x27;s'), "it's")
  })

  it('preserves plain text without tags', () => {
    assert.equal(stripHtml('just plain text'), 'just plain text')
  })

  it('handles self-closing tags', () => {
    assert.equal(stripHtml('before<br/>after'), 'beforeafter')
    assert.equal(stripHtml('before<img src="x"/>after'), 'beforeafter')
  })
})

describe('sanitizeContent', () => {
  // SVG and math element blocking
  it('strips <svg> blocks', () => {
    const input = 'before<svg><circle r="10"/></svg>after'
    assert.equal(sanitizeContent(input), 'beforeafter')
  })

  it('strips <math> blocks', () => {
    const input = 'before<math><mi>x</mi></math>after'
    assert.equal(sanitizeContent(input), 'beforeafter')
  })

  it('strips <script> blocks', () => {
    const input = 'before<script>alert("xss")</script>after'
    assert.equal(sanitizeContent(input), 'beforeafter')
  })

  it('strips <iframe> blocks', () => {
    const input = 'before<iframe src="evil.com"></iframe>after'
    assert.equal(sanitizeContent(input), 'beforeafter')
  })

  it('strips <object> blocks', () => {
    const input = 'before<object data="evil.swf"></object>after'
    assert.equal(sanitizeContent(input), 'beforeafter')
  })

  it('strips <embed> tags', () => {
    const input = 'before<embed src="evil.swf">after'
    assert.equal(sanitizeContent(input), 'beforeafter')
  })

  it('strips <form> blocks', () => {
    const input = 'before<form action="phish"><input></form>after'
    assert.equal(sanitizeContent(input), 'beforeafter')
  })

  // Event handler attribute stripping
  it('strips onclick event handler from tags', () => {
    const input = '<a onclick="alert(1)" href="#">link</a>'
    const result = sanitizeContent(input)
    assert.ok(!result.includes('onclick'), 'onclick should be stripped')
    assert.ok(result.includes('href="#"'), 'legitimate href should be preserved')
  })

  it('strips onerror event handler from tags', () => {
    const input = '<img onerror="alert(1)" src="x">'
    const result = sanitizeContent(input)
    assert.ok(!result.includes('onerror'), 'onerror should be stripped')
  })

  it('strips onload event handler from tags', () => {
    const input = '<body onload="alert(1)">'
    const result = sanitizeContent(input)
    assert.ok(!result.includes('onload'), 'onload should be stripped')
  })

  it('strips onmouseover event handler from tags', () => {
    const input = '<div onmouseover="alert(1)">hover</div>'
    const result = sanitizeContent(input)
    assert.ok(!result.includes('onmouseover'), 'onmouseover should be stripped')
  })

  it('strips multiple event handlers from a single tag', () => {
    const input = '<div onclick="a()" onmouseover="b()">text</div>'
    const result = sanitizeContent(input)
    assert.ok(!result.includes('onclick'), 'onclick should be stripped')
    assert.ok(!result.includes('onmouseover'), 'onmouseover should be stripped')
  })

  // Dangerous URL scheme stripping
  it('neutralizes javascript: URLs in href', () => {
    const input = '<a href="javascript:alert(1)">link</a>'
    const result = sanitizeContent(input)
    assert.ok(!result.includes('javascript:'), 'javascript: scheme should be removed')
  })

  it('neutralizes vbscript: URLs in href', () => {
    const input = '<a href="vbscript:msgbox(1)">link</a>'
    const result = sanitizeContent(input)
    assert.ok(!result.includes('vbscript:'), 'vbscript: scheme should be removed')
  })

  it('neutralizes data: URLs in src', () => {
    const input = '<img src="data:text/html,<script>alert(1)</script>">'
    const result = sanitizeContent(input)
    assert.ok(!result.includes('data:text/html'), 'data: scheme should be removed')
  })

  // Legitimate content preservation
  it('preserves legitimate code content like Array<string>', () => {
    const input = 'Use `Array<string>` for typed arrays'
    assert.equal(sanitizeContent(input), input)
  })

  it('preserves comparison operators like a < b', () => {
    const input = 'if a < b then do something'
    assert.equal(sanitizeContent(input), input)
  })

  it('preserves markdown content', () => {
    const input = '# Heading\n\n- item 1\n- item 2\n\n**bold** text'
    assert.equal(sanitizeContent(input), input)
  })

  it('preserves prose containing "onload" outside of HTML tags', () => {
    const input = 'use onload=lazy for image loading'
    assert.equal(sanitizeContent(input), input)
  })

  it('preserves prose containing "javascript:" outside of HTML tags', () => {
    const input = 'the javascript: pseudo-protocol is dangerous'
    assert.equal(sanitizeContent(input), input)
  })

  it('handles case-insensitive dangerous tag matching', () => {
    const input = 'before<SCRIPT>alert(1)</SCRIPT>after'
    assert.equal(sanitizeContent(input), 'beforeafter')
  })
})

describe('sanitizeText', () => {
  it('strips HTML and trims whitespace', () => {
    assert.equal(sanitizeText('  <b>hello</b>  '), 'hello')
  })

  it('returns empty string for whitespace-only input with tags', () => {
    assert.equal(sanitizeText('  <br>  '), '')
  })
})
