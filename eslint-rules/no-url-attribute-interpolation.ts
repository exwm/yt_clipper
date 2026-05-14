import type { Rule } from 'eslint';
import type {
  AssignmentExpression,
  CallExpression,
  MemberExpression,
  Node,
  TaggedTemplateExpression,
} from 'estree';

// URL-context HTML attributes in template bindings. In HTML, these attribute
// names unambiguously carry URL values (e.g. `<object data="...">`).
const URL_ATTRS = [
  'href',
  'src',
  'action',
  'formaction',
  'poster',
  'background',
  'cite',
  'data',
  'ping',
  'xlink:href',
  'xlink:show',
  'xlink:actuate',
] as const;

const URL_ATTR_PATTERN = new RegExp(
  `(?:^|\\s)(${URL_ATTRS.join('|').replace(/:/g, '\\:')})\\s*=\\s*["']?$`,
  'i'
);

const URL_ATTR_SET = new Set<string>(URL_ATTRS);

// URL-valued DOM properties on common elements. Narrower than the attribute
// set to avoid false positives — `.data` is commonly a data payload (Chart.js),
// `.background` is commonly CSS. Note camelCase `formAction` (DOM property) vs
// `formaction` (attribute).
const URL_PROP_NAMES = new Set<string>(['href', 'src', 'action', 'formAction', 'poster']);

// Returns true if the node is a compile-time-safe string constant:
// a string literal, or a template literal with no interpolations.
function isStaticStringExpression(node: Node): boolean {
  if (node.type === 'Literal') return typeof node.value === 'string';
  if (node.type === 'TemplateLiteral') return node.expressions.length === 0;
  return false;
}

// Matches `location` (Identifier) or `<anything>.location` (MemberExpression).
// Used for both assignment targets (`location = x`) and call receivers
// (`location.assign(x)`).
function isLocationReference(node: Node): boolean {
  if (node.type === 'Identifier') return node.name === 'location';
  if (node.type === 'MemberExpression' && !node.computed) {
    return node.property.type === 'Identifier' && node.property.name === 'location';
  }
  return false;
}

// Matches `window` / `self` / `globalThis`. Skips Object.open, XMLHttpRequest.open, etc.
function isWindowReference(node: Node): boolean {
  if (node.type !== 'Identifier') return false;
  return node.name === 'window' || node.name === 'self' || node.name === 'globalThis';
}

// Returns the property name of a MemberExpression, handling both non-computed
// (`obj.prop`) and computed-with-literal (`obj['prop']`) forms. Returns null
// for computed-with-non-literal (`obj[x]`) — those can't be checked statically.
function getStaticPropertyName(memberExpr: MemberExpression): string | null {
  if (!memberExpr.computed && memberExpr.property.type === 'Identifier') {
    return memberExpr.property.name;
  }
  if (
    memberExpr.computed &&
    memberExpr.property.type === 'Literal' &&
    typeof memberExpr.property.value === 'string'
  ) {
    return memberExpr.property.value;
  }
  return null;
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Forbid dynamic URL values in lit templates and DOM property assignments',
    },
    schema: [],
    messages: {
      dynamicUrlAttr:
        'Dynamic interpolation into `{{attr}}=` is forbidden. lit-html does not strip `javascript:` / `data:` URL schemes. Hardcode the URL, or eslint-disable-next-line with a security-reviewed reason.',
      dynamicUrlProp:
        'Dynamic assignment to `.{{prop}}` is forbidden. Browsers do not strip `javascript:` / `data:` URL schemes from property writes. Hardcode the URL, or eslint-disable-next-line with a security-reviewed reason.',
      dynamicNavUrl:
        'Dynamic URL passed to `{{sink}}` is forbidden. `javascript:` URLs navigate and execute. Hardcode the URL, or eslint-disable-next-line with a security-reviewed reason.',
    },
  },
  create(context) {
    // Reports `node` unless it's a compile-time-safe string constant.
    const reportIfDynamic = (
      node: Node,
      messageId: 'dynamicUrlAttr' | 'dynamicUrlProp' | 'dynamicNavUrl',
      data: Record<string, string>
    ): void => {
      if (isStaticStringExpression(node)) return;
      context.report({ node, messageId, data });
    };

    const checkTemplateBindings = (node: TaggedTemplateExpression): void => {
      const tag = node.tag;
      const tagName =
        tag.type === 'Identifier'
          ? tag.name
          : tag.type === 'MemberExpression' && tag.property.type === 'Identifier'
            ? tag.property.name
            : null;
      if (tagName !== 'html' && tagName !== 'svg') return;
      const { quasis, expressions } = node.quasi;
      for (let i = 0; i < expressions.length; i++) {
        const match = URL_ATTR_PATTERN.exec(quasis[i].value.raw);
        if (match) {
          context.report({
            node: expressions[i],
            messageId: 'dynamicUrlAttr',
            data: { attr: match[1] },
          });
        }
      }
    };

    const checkAssignment = (node: AssignmentExpression): void => {
      if (node.operator !== '=') return;
      const left = node.left;

      // Navigation sink: `location = x` / `window.location = x`. Assigning a
      // string to Location implicitly sets `.href`, triggering navigation.
      if (isLocationReference(left)) {
        reportIfDynamic(node.right, 'dynamicNavUrl', { sink: 'location =' });
        return;
      }

      // URL property write: `el.href = x` / `el.src = x` / etc.
      if (left.type !== 'MemberExpression') return;
      const propName = getStaticPropertyName(left);
      if (propName == null || !URL_PROP_NAMES.has(propName)) return;
      reportIfDynamic(node.right, 'dynamicUrlProp', { prop: propName });
    };

    const checkSetAttributeCall = (
      node: CallExpression,
      methodName: 'setAttribute' | 'setAttributeNS'
    ): void => {
      // setAttribute(name, value) — name at arg 0, value at arg 1.
      // setAttributeNS(ns, name, value) — name at arg 1, value at arg 2.
      const [nameArg, valueArg] =
        methodName === 'setAttribute'
          ? [node.arguments[0], node.arguments[1]]
          : [node.arguments[1], node.arguments[2]];
      if (!nameArg || !valueArg) return;
      if (nameArg.type !== 'Literal' || typeof nameArg.value !== 'string') return;
      const attrName = nameArg.value.toLowerCase();
      if (!URL_ATTR_SET.has(attrName)) return;
      reportIfDynamic(valueArg, 'dynamicUrlAttr', { attr: attrName });
    };

    const checkCall = (node: CallExpression): void => {
      if (node.callee.type !== 'MemberExpression') return;
      if (node.callee.property.type !== 'Identifier') return;
      const methodName = node.callee.property.name;
      const receiver = node.callee.object;

      // Navigation sink: location.assign(url) / location.replace(url).
      if ((methodName === 'assign' || methodName === 'replace') && isLocationReference(receiver)) {
        const [urlArg] = node.arguments;
        if (urlArg) reportIfDynamic(urlArg, 'dynamicNavUrl', { sink: `location.${methodName}()` });
        return;
      }

      // Navigation sink: window.open(url, ...).
      if (methodName === 'open' && isWindowReference(receiver)) {
        const [urlArg] = node.arguments;
        if (urlArg) reportIfDynamic(urlArg, 'dynamicNavUrl', { sink: 'window.open()' });
        return;
      }

      // Attribute sink: setAttribute / setAttributeNS with a URL attribute name.
      if (methodName === 'setAttribute' || methodName === 'setAttributeNS') {
        checkSetAttributeCall(node, methodName);
      }
    };

    return {
      TaggedTemplateExpression: checkTemplateBindings,
      AssignmentExpression: checkAssignment,
      CallExpression: checkCall,
    };
  },
};

export default rule;
