const SUBSCRIPTION_PLANS = {
  monthly: {
    key: 'monthly',
    label: '1 Month',
    months: 1,
    price: 3,
  },
  quarterly: {
    key: 'quarterly',
    label: '3 Months',
    months: 3,
    price: 5,
  },
  semiannual: {
    key: 'semiannual',
    label: '6 Months',
    months: 6,
    price: 10,
  },
  yearly: {
    key: 'yearly',
    label: '12 Months',
    months: 12,
    price: 20,
  },
};

const addMonths = (dateValue, months) => {
  const next = new Date(dateValue);
  next.setMonth(next.getMonth() + months);
  return next;
};

const getSubscriptionPlan = (planKey) => {
  return SUBSCRIPTION_PLANS[planKey] || null;
};

const validateVirtualVisa = (payment = {}) => {
  const cardHolder = String(payment.cardHolder || '').trim();
  const rawCardNumber = String(payment.cardNumber || '').replace(/\s+/g, '');
  const expiry = String(payment.expiry || '').trim();
  const cvv = String(payment.cvv || '').trim();

  if (!cardHolder || !rawCardNumber || !expiry || !cvv) {
    return {
      ok: false,
      message: 'Card holder, card number, expiry and CVV are required.',
    };
  }

  if (!/^4\d{15}$/.test(rawCardNumber)) {
    return {
      ok: false,
      message: 'Use a virtual Visa number that starts with 4 and has 16 digits.',
    };
  }

  if (!/^\d{3,4}$/.test(cvv)) {
    return {
      ok: false,
      message: 'CVV must be 3 or 4 digits.',
    };
  }

  if (!/^(0[1-9]|1[0-2])\/\d{2}$/.test(expiry)) {
    return {
      ok: false,
      message: 'Expiry must be in MM/YY format.',
    };
  }

  const [monthText, yearText] = expiry.split('/');
  const expiryDate = new Date(
    2000 + Number(yearText),
    Number(monthText),
    0,
    23,
    59,
    59,
    999
  );

  if (Number.isNaN(expiryDate.getTime()) || expiryDate < new Date()) {
    return {
      ok: false,
      message: 'This virtual Visa card is expired.',
    };
  }

  return {
    ok: true,
    payment: {
      cardHolder,
      cardNumber: rawCardNumber,
      expiry,
      cvv,
      last4: rawCardNumber.slice(-4),
      brand: 'Visa',
      gateway: 'virtual_visa',
    },
  };
};

module.exports = {
  SUBSCRIPTION_PLANS,
  addMonths,
  getSubscriptionPlan,
  validateVirtualVisa,
};
