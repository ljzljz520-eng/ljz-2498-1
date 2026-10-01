const CN_DIGITS = ['零','一','二','三','四','五','六','七','八','九'];
export function chineseNumber(n) {
  if (n <= 0) return String(n);
  if (n < 10) return CN_DIGITS[n];
  if (n < 20) return `十${n === 10 ? '' : CN_DIGITS[n % 10]}`;
  if (n < 100) {
    const tens = Math.floor(n / 10);
    const rest = n % 10;
    return `${CN_DIGITS[tens]}十${rest ? CN_DIGITS[rest] : ''}`;
  }
  return String(n);
}

export function ordinalFromPath(path) {
  return path.map(index => index + 1);
}

export function clauseNumber(kind, path) {
  const ordinal = ordinalFromPath(path);
  if (kind === 'attachment') {
    return `附件${ordinal[0] ?? 1}${ordinal.length > 1 ? '-' + ordinal.slice(1).join('.') : ''}`;
  }
  if (ordinal.length === 1) return chineseNumber(ordinal[0]);
  return ordinal.join('.');
}

export function referenceLabel(node, path) {
  const number = clauseNumber(node.kind, path);
  if (node.kind === 'attachment') return node.title ? `${number}《${node.title}》` : number;
  return node.title ? `${number}、${node.title}` : number;
}
