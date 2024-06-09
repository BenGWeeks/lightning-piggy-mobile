// src/services/lnbitsService.ts

const paylinkId = process.env.REACT_APP_LNBITS_PAYLINK_ID;
const userName = process.env.REACT_APP_LNBITS_USERNAME;
const password = process.env.REACT_APP_LNBITS_PASSWORD;

const getAccessToken = async (username: string, password: string) => {
  try {
    const response = await fetch('/api/v1/auth', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username, password }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data.access_token; // or data.userId, depending on the API
  } catch (error) {
    console.error('Error:', error);
    return null;
  }
};

const getWallets = async () => {
  try {
    const accessToken = await getAccessToken(`${userName}`, `${password}`);
    const response = await fetch('/api/v1/wallets', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        //'X-Api-Key': apiKey,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error:', error);
    return null;
  }
};

const getWalletDetails = async (apiKey: string, walletId: string) => {
  try {
    const response = await fetch(`/api/v1/wallets/${walletId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': apiKey,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error:', error);
    return null;
  }
};

const getWalletBalance = async (apiKey: string) => {
  console.log("Getting balance ...");
  try {
    const response = await fetch('/api/v1/wallet', 
    {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': apiKey,
      },
    }
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data.balance / 1000;
  } catch (error) {
    console.error('Error:', error);
    return null;
  }
};

const getWalletName = async (apiKey: string) => {
  console.log("Getting name ...");
  try {
    const response = await fetch('/api/v1/wallet', 
    {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': apiKey,
      },
    }
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data.name;
  } catch (error) {
    console.error('Error:', error);
    return null;
  }
};

const getPayments = async (apiKey: string) => {
  console.log("Getting balance ...");
  try {
    const response = await fetch('/api/v1/payments?limit=100', 
    {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': apiKey,
      },
    }
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error:', error);
    return null;
  }
};

const getWalletPayLinks = async (invoiceKey: string, walletId: string) => {
  try {
    const response = await fetch(`/lnurlp/api/v1/links?all_wallets=false&wallet=${walletId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': invoiceKey,
      },
    });

    if (!response.ok) {
      console.error(`getWalletPayLinks Error: ${response.status}`);
      return null;
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('getWalletPayLinks Error:', error);
    return null;
  }
};

const getWalletId = async (apiKey: string) => {
  console.log("getWalletId: Starting ...");
  try {
    const response = await fetch('/api/v1/wallets', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': apiKey,
      },
    });

    if (!response.ok) {
      console.error(`getWalletId error: ${response.status}`);
      return null;
    }

    const data = await response.json();

    // Find the wallet with a matching inkey
    const wallet = data.find((wallet: any) => wallet.inkey === apiKey);

    if (!wallet) {
      console.error('getWalletId: No wallet found for this apiKey');
      return null;
    }

    // Return the id of the wallet
    return wallet.id;
  } catch (error) {
    console.error('getWalletId error:', error);
    return null;
  }
};

const getInvoicePayment = async (apiKey: string, invoice: string) => {
  console.log("getInvoicePayment: Starting ...");
  try {
    const response = await fetch(`/api/v1/payments/${invoice}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': apiKey,
      },
    });

    if (!response.ok) {
      throw new Error(`getInvoicePayment error: ${response.status}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('getInvoicePayment error:', error);
    return false;
  }
};

const getPaymentsSince = async (apiKey: string, timestamp: number) => {
  console.log("getPaymentsSince: Starting ...");
  // Note that the timestamp is in seconds, not milliseconds.
  try {
    // Get walletId using the provided apiKey
    const walletId = await getWalletId(apiKey);

    const response = await fetch(`/api/v1/payments?wallet=${walletId}&limit=1`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': apiKey,
      },
    });

    if (!response.ok) {
      throw new Error(`getPaymentsSince error: ${response.status}`);
    }

    const data = await response.json();

    // Filter the payments to only include those since the provided timestamp
    const paymentsSince = data.filter((payment: { time: number }) => payment.time >= timestamp);

    console.log(`getPaymentsSince count is ${paymentsSince.length} since ${timestamp}`);

    return paymentsSince;
  } catch (error) {
    console.error('getPaymentsSince error:', error);
    return [];
  }
};

const createInvoice = async (apiKey: string) => {
  console.log("createInvoice: Starting ...");
  try {
    // Get the pay links for the wallet
    // Get walletId using the provided apiKey
    const walletId = await getWalletId(apiKey);

    if (!walletId) {
      console.error('createInvoice: No wallet found for this apiKey');
      return null;
    }

    const payLinks = await getWalletPayLinks(apiKey, walletId);

    // Check if there are any pay links
    if (!payLinks || payLinks.length === 0) {
      console.error('createInvoice: No pay links found for this wallet');
      return null;
    }

    // Use the id of the first pay link for that wallet
    const payLinkId = payLinks[0].id;

    const response = await fetch(`/lnurlp/api/v1/links/${payLinkId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': apiKey,
      },
    });

    if (!response.ok) {
      console.error(`createInvoice error: ${response.status}`);
      return null;
    }

    const data = await response.json();
    return data.lnurl;
  } catch (error) {
    console.error('createInvoice error:', error);
    return null;
  }
};

export default {
  getWallets,
  getWalletName,
  getWalletId,
  getWalletBalance,
  getPayments,
  getWalletDetails,
  getWalletPayLinks,
  getInvoicePayment,
  getPaymentsSince,
  createInvoice,
};
