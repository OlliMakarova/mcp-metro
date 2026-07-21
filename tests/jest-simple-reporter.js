export default class SimpleReporter {
  onRunComplete(contexts, runResults) {
    const { numPassedTests, numFailedTests, numPendingTests } = runResults;
    const total = numPassedTests + numFailedTests + numPendingTests;
    const actualSuccess = numFailedTests === 0 && total > 0;

    console.log(
      `\nTest Results: ${numPassedTests} passed, ${numFailedTests} failed, ${numPendingTests} skipped (${total} total)`,
    );
    console.log(`Status: ${actualSuccess ? 'PASSED' : 'FAILED'}`);
  }
}
