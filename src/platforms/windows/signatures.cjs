function validateSignatures(files, signatures, { unsignedExecutable = false, matchingRuntime = false } = {}) {
  if (!Array.isArray(signatures) || signatures.length !== files.length || signatures.some((signature, index) =>
    signature.file !== files[index] || (unsignedExecutable && index === 0 ? signature.status !== 'NotSigned' :
      signature.status !== 'Valid' || !/(?:^|,\s*)O="?OpenAI OpCo, LLC"?(?:,|$)/.test(signature.subject || '')))) {
    throw new Error('The Windows runtime must have valid OpenAI Authenticode signatures.');
  }
  if (matchingRuntime) {
    const [executable, chrome] = signatures;
    if (!executable.fileVersion?.trim() || executable.fileVersion !== chrome.fileVersion ||
        !executable.productName || executable.productName !== chrome.productName) {
      throw new Error('The signed Windows executable and chrome.dll must belong to the same runtime version.');
    }
  }
}

module.exports = { validateSignatures };
