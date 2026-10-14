// The signed-in account: profile, settings, payment methods and picture, and other
// people's pictures

import { Hono } from 'hono';
import { AppEnv, json, readJson } from '../app';
import { deleteAvatar, getAvatar, putAvatar } from '../photos';
import { getProfile, patchProfile, putPaymentMethods } from '../profiles';

const me = new Hono<AppEnv>();

me.get('/me', async (c) => json(await getProfile(c.env.DB, c.var.email)));

me.patch('/me', async (c) => {
  const body = await readJson(c.req.raw);
  if (body instanceof Response) return body;
  return patchProfile(c.env.DB, c.var.email, body);
});

me.put('/me/payment-methods', async (c) => {
  const body = await readJson(c.req.raw);
  if (body instanceof Response) return body;
  return putPaymentMethods(c.env.DB, c.var.email, body);
});

me.put('/me/avatar', (c) => putAvatar(c.req.raw, c.env.DB, c.var.email));
me.delete('/me/avatar', (c) => deleteAvatar(c.env.DB, c.var.email));

me.get('/avatars/:email', (c) =>
  getAvatar(c.env.DB, c.var.email, c.req.param('email').toLowerCase()),
);

export default me;
