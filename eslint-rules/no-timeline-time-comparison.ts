import type { Rule } from 'eslint';
import type { BinaryExpression, Node } from 'estree';

// Times on the video timeline mean frames: a marker pair covers the frames from its start marker's
// through its end marker's, and a point stored at a frame's start means that whole frame. Ordering
// such a time against another with < or > misses the rest of the frame (the playhead mid end-frame
// reads as outside the pair). Compare frames with `frameAt`, `sameFrame` or `isInFrameSpan`
// (util/frame-grid.ts). Where time is the right unit (interpolation, sorting, seek targets), disable
// the rule on the line with the reason.
// The type of marker and point times (@types/yt_clipper.d.ts). It follows a value through copies,
// destructuring and parameters, so `const { end } = pair; time < end` is still caught.
const TIMELINE_TIME = 'TimelineTime';

const ORDERING = new Set(['<', '<=', '>', '>=']);

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'disallow ordering a marker or point time with < or >; compare frames instead',
    },
    messages: {
      compareFrames:
        '{{property}} is a {{type}}, a frame on the timeline: compare frames (frameAt, sameFrame, isInFrameSpan), not times.',
    },
    schema: [],
  },
  create(context) {
    const services = context.sourceCode.parserServices as
      | {
          program?: { getTypeChecker(): any };
          esTreeNodeToTSNodeMap?: { get(node: Node): any };
        }
      | undefined;
    if (!services?.program || !services.esTreeNodeToTSNodeMap) return {};
    const checker = services.program.getTypeChecker();
    const nodeMap = services.esTreeNodeToTSNodeMap;

    const timelineTime = (node: Node): { type: string; property: string } | null => {
      const type = checker.getTypeAtLocation(nodeMap.get(node));
      const types = type.isUnion?.() ? type.types : [type];
      if (!types.some((t: any) => t.aliasSymbol?.getName() === TIMELINE_TIME)) return null;
      const property =
        node.type === 'MemberExpression' && node.property.type === 'Identifier'
          ? node.property.name
          : node.type === 'Identifier'
            ? node.name
            : 'value';
      return { type: TIMELINE_TIME, property };
    };
    return {
      BinaryExpression(node: BinaryExpression & Rule.NodeParentExtension) {
        if (!ORDERING.has(node.operator)) return;
        const time = timelineTime(node.left as Node) ?? timelineTime(node.right);
        if (time) context.report({ node, messageId: 'compareFrames', data: time });
      },
    };
  },
};

export default rule;
