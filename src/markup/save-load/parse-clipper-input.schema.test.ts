import Ajv2020 from 'ajv/dist/2020';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

import {
  cropPointAllow,
  markerPairAllow,
  overridesAllow,
  parseClipperInput,
  speedPointAllow,
  topLevelAllow,
} from './parse-clipper-input';

// The clipper validates markers JSON files against this schema, so the markup must save exactly
// what it describes.
const schemaDir = join(__dirname, '../../schema');
const schema = JSON.parse(readFileSync(join(schemaDir, 'markers.schema.json'), 'utf-8'));
const examplesDir = join(schemaDir, 'examples');
const examples = readdirSync(examplesDir).map((name) => [
  name,
  JSON.parse(readFileSync(join(examplesDir, name), 'utf-8')),
]);
const validate = new Ajv2020({ allErrors: true }).compile(schema);

const keys = (allow: Record<string, true>) => Object.keys(allow).sort();
const schemaKeys = (properties: Record<string, unknown>) => Object.keys(properties).sort();

describe('markers JSON schema', () => {
  test.each([
    ['top level', topLevelAllow, schema.properties],
    ['marker pair', markerPairAllow, schema.$defs.markerPair.properties],
    ['overrides', overridesAllow, schema.$defs.overrides.properties],
    ['speed point', speedPointAllow, schema.$defs.speedPoint.properties],
    ['crop point', cropPointAllow, schema.$defs.cropPoint.properties],
  ])('%s allowlist lists exactly the schema properties', (_name, allow, properties) => {
    expect(keys(allow)).toEqual(schemaKeys(properties));
  });

  test.each(examples)('%s parses cleanly and validates against the schema', (_name, example) => {
    const { input, issues } = parseClipperInput(example);
    expect(issues).toEqual([]);
    validate(input);
    expect(validate.errors ?? []).toEqual([]);
  });
});
