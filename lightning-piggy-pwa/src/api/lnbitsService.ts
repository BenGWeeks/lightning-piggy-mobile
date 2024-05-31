// src/services/lnbitsService.ts

const paylinkId = process.env.REACT_APP_LNBITS_PAYLINK_ID;

const getBalance = async () => {
  console.log("Getting balance ...");
  try {
    const response = await fetch('/api/v1/wallet');

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data.balance;
  } catch (error) {
    console.error('Error:', error);
    return null;
  }
};

const getPayments = async () => {
  console.log("Getting balance ...");
  try {
    const response = await fetch('/api/v1/payments?limit=100');

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

const createInvoice = async (amount?: number, memo?: string) => {
  console.log("Creating invoice ...");

  try {
    let response;

    if (amount) {
      // use the regular API to create an invoice
      response = await fetch('/api/v1/payments', {
        method: 'POST',
        headers: {
          //'X-Api-Key': API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          out: false,
          amount,
          memo,
        }),
      });
    } else {
      // use the Pay Links API to create a pay link
      response = await fetch(`/lnurlp/api/v1/links/${paylinkId}`, {
        method: 'GET',
        headers: {
          //'X-Api-Key': API_KEY,
          'Content-Type': 'application/json',
        },
      });
    }

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return amount ? data.payment_request : data.lnurl;
  } catch (error) {
    console.error('Error:', error);
    return null;
  }
};

export default {
  getBalance,
  getPayments,
  createInvoice
};
