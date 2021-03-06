const { get } = require('lodash')
const mongoose = require('mongoose')
const { getWeb3 } = require('@services/web3')
const { getAbi } = require('@constants/abi')
const { logsToEvents } = require('@utils/web3/events')
const { isEmpty } = require('@utils/web3/receipt')
const { getEventHandlers, handleEvent } = require('@handlers/events')
const transactionMethods = mongoose.transaction

const handleReceipt = async (receipt) => {
  const transaction = await transactionMethods.start(receipt)
  const status = get(transaction, 'status')
  if (status === 'DONE' || status === 'FAILED') {
    console.log(`Transaction ${receipt.transactionHash} already executed with status ${status}`)
    return
  }
  try {
    console.log(`Starting to execute transaction ${receipt.transactionHash}`)
    const events = Object.entries(receipt.events)
    let promisses = []
    const { bridgeType } = receipt
    const eventHandlers = getEventHandlers(receipt.bridgeType)
    for (let [eventName, event] of events) {
      if (eventHandlers.hasOwnProperty(eventName)) {
        if (Array.isArray(event)) {
          const eventPromisses = event.map((singleEvent) => handleEvent({ ...singleEvent, bridgeType }, receipt))
          promisses = [...promisses, ...eventPromisses]
        } else {
          event.bridgeType = receipt.bridgeType
          promisses.push(handleEvent(event, receipt))
        }
      }
    }
    await Promise.all(promisses)
    return transactionMethods.done(receipt)
  } catch (error) {
    await transactionMethods.failed(receipt)
    throw error
  }
}

const handleTransactionHash = async ({ transactionHash, bridgeType, abiName }) => {
  const web3 = getWeb3({ bridgeType })
  const receipt = await web3.eth.getTransactionReceipt(transactionHash)
  if (receipt && !isEmpty(receipt)) {
    const abi = getAbi(abiName)
    const contract = new web3.eth.Contract(abi)
    const events = logsToEvents(receipt.logs, contract)
    return handleReceipt({ ...receipt, events, bridgeType })
  } else {
    return transactionMethods.pending({ transactionHash, bridgeType, abiName })
  }
}

module.exports = {
  handleTransactionHash,
  handleReceipt
}
