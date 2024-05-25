// lnbitsService.ts
const getBalance = async (walletId: string, apiKey: string) => {
    try {
      const response = await fetch(`https://lnbits.com/api/v1/wallets/${walletId}/balance`, {
        headers: {
          'X-Api-Key': apiKey,
        },
      });
  
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
  
  export default {
    getBalance,
  };