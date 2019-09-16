/*
  Create an HDNode wallet using bitbox. The mnemonic from this wallet
  will be used in future examples.
*/

// Set NETWORK to either testnet or mainnet
const NETWORK = `testnet`

// Instantiate bitbox.
const bitboxLib = "./node_modules/bitbox-sdk/lib/BITBOX"
// const bitboxLib = "../../../lib/BITBOX"
const BITBOX = require(bitboxLib).BITBOX

// Instantiate SLP based on the network.
let bitbox
if (NETWORK === `mainnet`)
  bitbox = new BITBOX({ restURL: `https://rest.bitcoin.com/v2/` })
else bitbox = new BITBOX({ restURL: `https://trest.bitcoin.com/v2/` })

const fs = require("fs")
const walletFile = './wallet.json';
const memoFile = './memo.json'
const bitDbFile = './bitdb.json'


const createWalletFile = () => {

  const lang = "english" // Set the language of the wallet.
  
  // These objects used for writing wallet information out to a file.
  let outStr = ""
  const outObj = {}
  
  // create 256 bit BIP39 mnemonic
  const mnemonic = bitbox.Mnemonic.generate(
    128,
    bitbox.Mnemonic.wordLists()[lang]
  )
  console.log("BIP44 $BCH Wallet")
  outStr += "BIP44 $BCH Wallet\n"
  console.log(`128 bit ${lang} BIP39 Mnemonic: `, mnemonic)
  outStr += `\n128 bit ${lang} BIP32 Mnemonic:\n${mnemonic}\n\n`
  outObj.mnemonic = mnemonic
  
  // root seed buffer
  const rootSeed = bitbox.Mnemonic.toSeed(mnemonic)
  
  // master HDNode
  let masterHDNode
  if (NETWORK === `mainnet`) masterHDNode = bitbox.HDNode.fromSeed(rootSeed)
  else masterHDNode = bitbox.HDNode.fromSeed(rootSeed, NETWORK)
  
  // HDNode of BIP44 account
  console.log(`BIP44 Account: "m/44'/145'/0'"`)
  outStr += `BIP44 Account: "m/44'/145'/0'"\n`
  
  // Generate the first 10 seed addresses.
  for (let i = 0; i < 10; i++) {
    const childNode = masterHDNode.derivePath(`m/44'/145'/0'/0/${i}`)
    console.log(`m/44'/145'/0'/0/${i}: ${bitbox.HDNode.toCashAddress(childNode)}`)
    outStr += `m/44'/145'/0'/0/${i}: ${bitbox.HDNode.toCashAddress(childNode)}\n`
  
    // Save the first seed address for use in the .json output file.
    if (i === 0) {
      outObj.cashAddress = bitbox.HDNode.toCashAddress(childNode)
      outObj.legacyAddress = bitbox.HDNode.toLegacyAddress(childNode)
      outObj.WIF = bitbox.HDNode.toWIF(childNode)
    }
  }
  
  // Write the extended wallet information into a text file.
  fs.writeFileSync("wallet-info.txt", outStr, function(err) {
    if (err) return console.error(err)
  
    console.log(`wallet-info.txt written successfully.`)
  })
  
  // Write out the basic information into a json file for other example apps to use.
  fs.writeFileSync("wallet.json", JSON.stringify(outObj, null, 2), function(err) {
    if (err) return console.error(err)
    console.log(`wallet.json written successfully.`)
  })

  return walletFile;
}

const getBalanceDetails = async (walletInfo) => {
  try {
    // first get BCH balance
    const balance = await bitbox.Address.details(walletInfo.cashAddress)

    console.log(`BCH Balance information:`)
    console.log(balance)

    return balance
  } catch (err) {
    console.error(`Error in getBalance: `, err)
    throw err
  }
}


const findBestUtxo = async (senderAddress) => {
  try {
    const details = await bitbox.Address.utxo(senderAddress);

    let bestUtxo = details.utxos[0];
    if (details.cashAddress === senderAddress) {
      details.utxos.forEach((element) => {
        if (element.satoshis > bestUtxo.satoshis) {
          bestUtxo = element;
        }
      });
    }

    return bestUtxo;

  } catch (error) {
    console.error(error)
  }
}


const postMemoMessage = async (walletInfo, memoMessage) => {
  const BITBOX = bitbox;
  const BITBOXNetName = NETWORK;

  const paymentKey = walletInfo.WIF;
  
  const ecpair = BITBOX.ECPair.fromWIF(paymentKey);

  // const senderAddress = BITBOX.ECPair.toCashAddress(ecpair);
  const senderAddress = walletInfo.cashAddress;

  const utxo = await findBestUtxo(senderAddress);

  const satoshisAvailable = utxo.satoshis;

  const messageBuffer = Buffer.from(memoMessage, 'utf8');
  const opReturn = BITBOX.Script.encode([
    BITBOX.Script.opcodes.OP_RETURN,
    Buffer.from("6d02", 'hex'),
    BITBOX.Script.opcodes.OP_PUSHDATA1,
    messageBuffer
  ]);

  const minerFee = 750;
  const returnToMeAmount = satoshisAvailable - minerFee;

  const transactionBuilder = new BITBOX.TransactionBuilder(BITBOXNetName);

  transactionBuilder.addInput(utxo.txid, utxo.vout);
  transactionBuilder.addOutput(opReturn, 0)
  // send rest of funds (minus miner's fee) back to sender's address
  transactionBuilder.addOutput(senderAddress, returnToMeAmount);

  const redeemScript = undefined;
  transactionBuilder.sign(0, ecpair, redeemScript, transactionBuilder.hashTypes.SIGHASH_ALL, satoshisAvailable);

  const tx = transactionBuilder.build();

  console.log("BUILDING DONE")
  console.log(tx)

  const hex = tx.toHex();
  console.log(hex)
  console.log("TX SIZE: " + (hex.length / 2))

  const txId = tx.getId();
  console.log("TXID: " + txId)

  const result = await BITBOX.RawTransactions.sendRawTransaction(hex);
  console.log(result)

  const memoData = {
    message: memoMessage,
    txid: txId
  }

  fs.writeFileSync("memo.json", JSON.stringify(memoData, null, 2), function(err) {
    if (err) return console.error(err)
    console.log(`memo.json written successfully.`)
  })

  return result;
}


const getMemoData = () => {
  if (fs.existsSync("memo.json")) {
    var memoInfo = require("memo.json")
    return memoInfo
  }
}


const getBitDbQueryLink = (txid) => {
  const q = {
    "v": 3,
    "q": {
      "find": { "tx.h": txid },
    },
    "r": {
      "f": "[ .[] | {addr: .in[0].e.a, msg: .out[0].s2, txid: .tx.h} ]"
    }
  }

  const qStr = JSON.stringify(q);
  const qJsonB64 = Buffer.from(qStr).toString("base64");

  const bitdbUrl = "https://tbitdb.bitcoin.com/q/" + qJsonB64

  return bitdbUrl;
}


const saveBitDbQueryResult = async (queryUrl) => {
  return new Promise((resolve, reject) => {
    const https = require('https');

    console.log("LOADING BITDB RESULT");
    console.log(queryUrl)

    https.get(queryUrl, async (response) => {
      const body = [];
      // on every content chunk, push it to the data array
      response.on('data', (chunk) => body.push(chunk));
      // we are done, resolve promise with those joined chunks
      response.on('end', () => {
        const json = body.join('');
        fs.writeFileSync(bitDbFile, json);
        console.log("BIT DB FILE WRITTEN");
        resolve();
      });
    });
  });
}


// start of test
(async () => {
  if (!fs.existsSync(walletFile)) {
    createWalletFile();
  }

  var walletInfo = require(walletFile)
  const bitboxAddress = walletInfo.cashAddress;

  const balance = await getBalanceDetails(walletInfo)

  if (balance.balanceSat < 1) {
    console.log("Go to testnet faucet to get some tBCH");
    console.log("Go to https://developer.bitcoin.com/faucets/bch/");
    console.log("Send some tBCH to address " + bitboxAddress);
  
  } else {
    console.log("Have a balance, so make a memo post (if necessary), get its TXID, then compare BITBOX/BitDb addresses")

    if (!fs.existsSync(memoFile)) {
      const memoMessage = "TEST MESSAGE: " + new Date()
      await postMemoMessage(walletInfo, memoMessage);
    } 
    
    const memoInfo = require(memoFile)
    console.log("MEMO POST TXID: " + memoInfo.txid);

    const bitDbLink = getBitDbQueryLink(memoInfo.txid);
    await saveBitDbQueryResult(bitDbLink);

    const bitDbJson = require(bitDbFile)

    const bitDbAddress = bitDbJson.c[0].addr;

    if (bitboxAddress === bitDbAddress) {
      console.log("BITBOX and BitDb use the same address: " + bitboxAddress)
    } else {
      console.log(`BITBOX and BitDb use different addresses: (Bitbox) ${bitboxAddress} -- (BitDb) bchtest:${bitDbAddress}`)
      console.log(`Check BITBOX balance: https://explorer.bitcoin.com/tbch/address/${bitboxAddress}`);
      console.log(`Check BitDb balance: https://explorer.bitcoin.com/tbch/address/bchtest:${bitDbAddress}`);
    }
  }
})()
