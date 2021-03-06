const router = require('express').Router()
const { agenda } = require('@services/agenda')
const auth = require('@routes/auth')
const mongoose = require('mongoose')
const UserWallet = mongoose.model('UserWallet')

/**
 * @api {post} /api/v2/admin/wallets/create Create wallet for phone number
 * @apiName CreateWallet
 * @apiGroup Admin
 * @apiDescription Start async job of creating a wallet for phone number (owned by the community admin)
 *
 * @apiExample Create wallet for the provided phone number
 *  POST /api/v2/admin/wallets/create
 *  body: { phoneNumber: '+972546123321' }
 *
 * @apiParam {String} phoneNumber phone number to create a wallet for (body parameter)
 *
 * @apiHeader {String} Authorization JWT Authorization in a format "Bearer {jwtToken}"
 *
 * @apiSuccess {String} Started job data
 */
router.post('/create', auth.required, async (req, res) => {
  const { isCommunityAdmin, accountAddress } = req.user
  if (!isCommunityAdmin) {
    return res.status(400).send({ error: 'The user is not a community admin' })
  }
  const { phoneNumber } = req.body

  await new UserWallet({ phoneNumber, accountAddress }).save()

  const job = await agenda.now('createWallet', { owner: accountAddress, phoneNumber })

  return res.json({ job: job.attrs })
})

module.exports = router
