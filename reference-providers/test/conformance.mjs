// test/conformance.mjs — run the PUBLISHED @zioladev/execution-control boundary
// conformance suite against our CHALLENGE-PERIOD execution gate. This verifies that
// the integration honors the seam's disposition law: only `allow` reaches the
// provider; block / indeterminate / throwing / missing authorities do not;
// evaluation occurs before mutation; reads and control-off bypass the seam.
//
// Run: node test/conformance.mjs
import {
  runExecutionControlConformance,
  renderConformanceReport,
} from '@zioladev/execution-control';

import { guardExecution } from '../kit/execution-gate.js';

// Express our gate as an ExecutionControlSubject: the provider is reached only if
// the gate permits the supplied mutation function to run. The harness injects its
// own neutral control doubles.
const subject = {
  async attempt({ effect, mode, control, candidate, reachProvider }) {
    if (effect !== 'state-changing' || mode === 'off') {
      await reachProvider();
      return { engagedControl: false };
    }

    if (!control) {
      // Missing authority: fail closed, so the provider is not reached.
      return { engagedControl: true };
    }

    await guardExecution({
      candidate,
      authority: control,
      mutate: reachProvider,
      emit: () => {},
    });

    return { engagedControl: true };
  },
};

const report = await runExecutionControlConformance(subject);

console.log(renderConformanceReport(report));

process.exit(report.pass ? 0 : 1);
