const config = require('config')
const { createNetwork, signMultiSig } = require('@utils/web3')
const WalletFactoryABI = require('@constants/abi/WalletFactory')
const WalletOwnershipManagerABI = require('@constants/abi/WalletOwnershipManager')
const MultiSigWalletABI = require('@constants/abi/MultiSigWallet')
const homeAddresses = config.get('network.home.addresses')
const { withAccount } = require('@utils/account')
const mongoose = require('mongoose')
const UserWallet = mongoose.model('UserWallet')
const Contact = mongoose.model('Contact')
const Invite = mongoose.model('Invite')
const branch = require('@utils/branch')
const smsProvider = require('@utils/smsProvider')

const createWallet = withAccount(async (account, { owner, communityAddress, phoneNumber, ens = '', name, amount, symbol, bonusInfo }, job) => {
  const { agenda } = require('@services/agenda')
  const { createContract, createMethod, send } = createNetwork('home', account)
  const walletFactory = createContract(WalletFactoryABI, homeAddresses.WalletFactory)
  const method = createMethod(walletFactory, 'createWallet', owner, Object.values(homeAddresses.walletModules), ens)

  const receipt = await send(method, {
    from: account.address
  }, {
    transactionHash: (hash) => {
      job.attrs.data.txHash = hash
      job.save()
    }
  })
  const walletAddress = receipt.events.WalletCreated.returnValues._wallet
  console.log(`Created wallet contract ${receipt.events.WalletCreated.returnValues._wallet} for account ${owner}`)

  job.attrs.data.walletAddress = walletAddress
  if (bonusInfo && communityAddress) {
    bonusInfo.bonusId = walletAddress
    const bonusJob = await agenda.now('bonus', { communityAddress, bonusInfo })
    job.attrs.data.bonusJob = {
      name: bonusJob.attrs.name,
      _id: bonusJob.attrs._id.toString()
    }
  }
  job.save()

  let cond = { accountAddress: owner }

  if (phoneNumber) {
    cond.phoneNumber = phoneNumber
  }

  const userWallet = await UserWallet.findOneAndUpdate(cond, { walletAddress })
  phoneNumber = userWallet.phoneNumber

  await Contact.updateMany({ phoneNumber }, { walletAddress, state: 'NEW' })

  if (communityAddress) {
    const { url } = await branch.createDeepLink({ communityAddress })
    console.log(`Created branch deep link ${url}`)

    let body = `${config.get('inviteTxt')}\n${url}`
    if (name && amount && symbol) {
      body = `${name} sent you ${amount} ${symbol}! Click here to redeem:\n${url}`
    }
    smsProvider.createMessage({ to: phoneNumber, body })

    await Invite.findOneAndUpdate({
      inviterWalletAddress: bonusInfo.receiver,
      inviteePhoneNumber: phoneNumber
    }, {
      inviteeWalletAddress: walletAddress
    }, {
      sort: { createdAt: -1 }
    })
  }

  return receipt
})

const setWalletOwner = withAccount(async (account, { walletAddress, newOwner }, job) => {
  const { createContract, createMethod, send, web3 } = createNetwork('home', account)

  const walletOwnershipManager = createContract(WalletOwnershipManagerABI, config.get('network.home.addresses.walletModules.WalletOwnershipManager'))
  const setOwnerMethod = createMethod(walletOwnershipManager, 'setOwner', walletAddress, newOwner)
  const setOwnerMethodData = setOwnerMethod.encodeABI()

  const multiSigWallet = createContract(MultiSigWalletABI, config.get('network.home.addresses.MultiSigWallet'))
  const signature = await signMultiSig(web3, account, multiSigWallet, walletOwnershipManager.address, setOwnerMethodData)

  const method = createMethod(multiSigWallet, 'execute', walletOwnershipManager.address, 0, setOwnerMethodData, signature)
  const receipt = await send(method, {
    from: account.address
  }, {
    transactionHash: (hash) => {
      job.attrs.data.txHash = hash
      job.save()
    }
  })
  await UserWallet.findOneAndUpdate({ walletAddress }, { accountAddress: newOwner })
  return receipt
})

module.exports = {
  createWallet,
  setWalletOwner
}
