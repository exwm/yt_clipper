import type { Rule } from 'eslint';
import type { BinaryExpression, MemberExpression, Node } from 'estree';

// Times on the video timeline mean frames: a marker pair covers the frames from its start marker's
// through its end marker's, and a point stored at a frame's start means that whole frame. Ordering
// such a time against another with < or > misses the rest of the frame (the playhead mid end-frame
// reads as outside the pair). Compare frames with `frameAt`, `sameFrame` or `isInFrameSpan`
// (util/frame-grid.ts). Where time is the right unit (interpolation, sorting, seek targets), disable
// the rule on the line with the reason.
const TIMELINE_TIMES: Record<string, readonly string[]> = {
  MarkerPair: ['start', 'end'],
  MarkerPairHistory: ['start', 'end'],
  CropPoint: ['x'],
  SpeedPoint: ['x'],
};

const ORDERING = new Set(['<', '<=', '>', '>=']);

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'disallow ordering a marker or point time with < or >; compare frames instead',
    },
    messages: {
      compareFrames:
        '{{type}}.{{property}} is a frame on the timeline: compare frames (frameAt, sameFrame, isInFrameSpan), not times.',
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
      if (node.type !== 'MemberExpression') return null;
      const member = node as MemberExpression;
      if (member.computed || member.property.type !== 'Identifier') return null;
      const property = member.property.name;
      const objectType = checker.getTypeAtLocation(nodeMap.get(member.object as Node));
      const symbol = objectType.aliasSymbol ?? objectType.getSymbol();
      const type: string | undefined = symbol?.getName();
      return type != null && TIMELINE_TIMES[type]?.includes(property) ? { type, property } : null;
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
