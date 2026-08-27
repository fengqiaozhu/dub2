function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function summarizeFishAccount({ creditData = {}, packageData = {} } = {}) {
  const credit = toFiniteNumber(creditData.credit);
  const packageBalance = toFiniteNumber(packageData.balance);
  const extraBalance = toFiniteNumber(packageData.extra_balance);
  const hasFreeCredit = creditData.has_free_credit === true;
  const packageAvailable = packageBalance > 0 || extraBalance > 0;
  const freeTierAvailable = hasFreeCredit || (packageData.type === 'free' && packageAvailable);
  const available = credit > 0 || packageAvailable || hasFreeCredit;

  return {
    available,
    credit,
    has_free_credit: creditData.has_free_credit ?? null,
    package: {
      type: packageData.type || null,
      total: toFiniteNumber(packageData.total),
      balance: packageBalance,
      extra_balance: extraBalance
    },
    recommended_model: credit <= 0 && freeTierAvailable ? 's2.1-pro-free' : 's2.1-pro'
  };
}

module.exports = {
  summarizeFishAccount
};
