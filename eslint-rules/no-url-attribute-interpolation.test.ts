import { RuleTester } from 'eslint';
import rule from './no-url-attribute-interpolation';

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
});

ruleTester.run('no-url-attribute-interpolation', rule, {
  valid: [
    // Template bindings — non-URL attribute positions.
    { code: "html`<option value=${resolution}></option>`" },
    { code: "html`<input data-id=${id} />`" },
    { code: "html`<div class=${cls}></div>`" },
    { code: "html`<input .value=${speed} />`" },
    // Template bindings — URL attributes with static values.
    { code: "html`<a href='/hardcoded'>link</a>`" },
    { code: "html`<img src=\"/static.png\" />`" },
    // Attribute names that look like URL attrs but aren't (substring match protection).
    { code: "html`<iframe srcdoc=${trusted} />`" },
    { code: "html`<input data-foo=${foo} />`" },
    // Non-lit tagged templates are ignored.
    { code: "css`body { color: ${c} }`" },
    { code: "String.raw`<a href=${x}>`" },
    // Property assignments — static string literals.
    { code: "homeLink.href = 'https://github.com/exwm/yt_clipper';" },
    { code: "el.src = 'icons/foo.png';" },
    { code: "form.action = `/api/static`;" },
    // Property assignments — non-URL properties.
    { code: "chart.data = newData;" },
    { code: "el.textContent = userText;" },
    { code: "el.style.background = 'red';" },
    { code: "obj.value = userInput;" },
    // Non-assignment operators (+=, etc.) not flagged — rare, not a URL-sink pattern.
    { code: "el.href += '?foo=bar';" },
    // setAttribute — static values.
    { code: "el.setAttribute('href', '/static');" },
    { code: "el.setAttribute('src', `/hardcoded.png`);" },
    // setAttribute — non-URL attributes.
    { code: "el.setAttribute('id', dynamicId);" },
    { code: "el.setAttribute('class', userClass);" },
    { code: "el.setAttribute('data-foo', userData);" },
    { code: "el.setAttribute('style', userStyles);" },
    // setAttribute — dynamic attribute name can't be checked statically; skipped.
    { code: "el.setAttribute(attrName, value);" },
    // setAttributeNS — static value.
    { code: "el.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', '#icon-static');" },
    // Navigation sinks — static URLs.
    { code: "location.href = '/login';" },
    { code: "window.open('https://example.com', '_blank');" },
    { code: "location.assign('/dashboard');" },
    { code: "location.replace(`/page`);" },
    // `.assign` / `.replace` on non-Location receivers must not fire (false-positive guard).
    { code: "Object.assign(target, source);" },
    { code: "str.replace(pattern, replacement);" },
    { code: "arr.replace(0, newItem);" },
    // `.open` on non-window receivers must not fire.
    { code: "xhr.open('GET', url);" },
    { code: "dialog.open();" },
  ],

  invalid: [
    // Template bindings — URL attribute interpolations.
    {
      code: "html`<a href=${userUrl}>click</a>`",
      errors: [{ messageId: 'dynamicUrlAttr', data: { attr: 'href' } }],
    },
    {
      code: "html`<img src=\"${userUrl}\" />`",
      errors: [{ messageId: 'dynamicUrlAttr', data: { attr: 'src' } }],
    },
    {
      code: "html`<iframe src='${userUrl}'></iframe>`",
      errors: [{ messageId: 'dynamicUrlAttr', data: { attr: 'src' } }],
    },
    {
      code: "html`<form action=${endpoint}></form>`",
      errors: [{ messageId: 'dynamicUrlAttr', data: { attr: 'action' } }],
    },
    {
      code: "html`<button formaction=${url}></button>`",
      errors: [{ messageId: 'dynamicUrlAttr', data: { attr: 'formaction' } }],
    },
    {
      code: "html`<video poster=${posterUrl}></video>`",
      errors: [{ messageId: 'dynamicUrlAttr', data: { attr: 'poster' } }],
    },
    // SVG tagged template + xlink:href.
    {
      code: "svg`<use xlink:href=${iconId} />`",
      errors: [{ messageId: 'dynamicUrlAttr', data: { attr: 'xlink:href' } }],
    },
    // Multiple URL interpolations in one template.
    {
      code: "html`<a href=${a}><img src=${b} /></a>`",
      errors: [
        { messageId: 'dynamicUrlAttr', data: { attr: 'href' } },
        { messageId: 'dynamicUrlAttr', data: { attr: 'src' } },
      ],
    },
    // Case-insensitive attribute match.
    {
      code: "html`<a HREF=${url}>`",
      errors: [{ messageId: 'dynamicUrlAttr', data: { attr: 'HREF' } }],
    },

    // Property assignments — URL props, dynamic right-hand side.
    {
      code: "homeLink.href = untrustedUrl;",
      errors: [{ messageId: 'dynamicUrlProp', data: { prop: 'href' } }],
    },
    {
      code: "el.src = source.currentSrc;",
      errors: [{ messageId: 'dynamicUrlProp', data: { prop: 'src' } }],
    },
    {
      code: "form.action = `${base}/api`;",
      errors: [{ messageId: 'dynamicUrlProp', data: { prop: 'action' } }],
    },
    {
      code: "button.formAction = getFormUrl();",
      errors: [{ messageId: 'dynamicUrlProp', data: { prop: 'formAction' } }],
    },
    {
      code: "video.poster = posterFromApi;",
      errors: [{ messageId: 'dynamicUrlProp', data: { prop: 'poster' } }],
    },
    // Computed property access.
    {
      code: "el['href'] = untrustedUrl;",
      errors: [{ messageId: 'dynamicUrlProp', data: { prop: 'href' } }],
    },
    // String concatenation on RHS → dynamic, flagged.
    {
      code: "a.href = 'https://example.com/' + userPath;",
      errors: [{ messageId: 'dynamicUrlProp', data: { prop: 'href' } }],
    },

    // setAttribute — URL attrs with dynamic values.
    {
      code: "el.setAttribute('href', untrustedUrl);",
      errors: [{ messageId: 'dynamicUrlAttr', data: { attr: 'href' } }],
    },
    {
      code: "el.setAttribute('src', source.currentSrc);",
      errors: [{ messageId: 'dynamicUrlAttr', data: { attr: 'src' } }],
    },
    {
      code: "form.setAttribute('action', endpoint);",
      errors: [{ messageId: 'dynamicUrlAttr', data: { attr: 'action' } }],
    },
    // Case-insensitive attr name match.
    {
      code: "el.setAttribute('HREF', untrustedUrl);",
      errors: [{ messageId: 'dynamicUrlAttr', data: { attr: 'href' } }],
    },
    // setAttributeNS — xlink:href with dynamic value.
    {
      code: "use.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', iconRef);",
      errors: [{ messageId: 'dynamicUrlAttr', data: { attr: 'xlink:href' } }],
    },
    // Template literal with expressions → dynamic, flagged.
    {
      code: "el.setAttribute('src', `${base}/img.png`);",
      errors: [{ messageId: 'dynamicUrlAttr', data: { attr: 'src' } }],
    },

    // Navigation sinks — dynamic URLs.
    {
      code: "location = untrustedUrl;",
      errors: [{ messageId: 'dynamicNavUrl', data: { sink: 'location =' } }],
    },
    {
      code: "window.location = untrustedUrl;",
      errors: [{ messageId: 'dynamicNavUrl', data: { sink: 'location =' } }],
    },
    {
      code: "document.location = untrustedUrl;",
      errors: [{ messageId: 'dynamicNavUrl', data: { sink: 'location =' } }],
    },
    {
      code: "location.assign(untrustedUrl);",
      errors: [{ messageId: 'dynamicNavUrl', data: { sink: 'location.assign()' } }],
    },
    {
      code: "location.replace(untrustedUrl);",
      errors: [{ messageId: 'dynamicNavUrl', data: { sink: 'location.replace()' } }],
    },
    {
      code: "window.location.assign(`${base}/page`);",
      errors: [{ messageId: 'dynamicNavUrl', data: { sink: 'location.assign()' } }],
    },
    {
      code: "window.open(untrustedUrl, '_blank');",
      errors: [{ messageId: 'dynamicNavUrl', data: { sink: 'window.open()' } }],
    },
    {
      code: "self.open(untrustedUrl);",
      errors: [{ messageId: 'dynamicNavUrl', data: { sink: 'window.open()' } }],
    },
  ],
});
