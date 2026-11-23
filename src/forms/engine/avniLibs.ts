// Avni's model and rule libraries, the same versions avni-webapp's data entry app runs
// (avni-webapp origin/18.3 package.json). Loaded only on the breast routes: they are large.
import * as models from "openchs-models";
import * as rulesConfig from "rules-config";
import { common, motherCalculations } from "avni-health-modules";
import lodash from "lodash";
import moment from "moment";
import { isValid } from "date-fns";

export { models, rulesConfig };

/** What an Avni rule receives as `imports` (RuleEvaluationService.getImports in avni-webapp). */
export const ruleImports = {
  rulesConfig,
  common,
  lodash,
  moment,
  date_fns: { isValid },
  motherCalculations,
  log: () => {},
};
