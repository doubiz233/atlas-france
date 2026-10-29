import test from 'node:test'
import assert from 'node:assert/strict'
import {
  companyMatchScore,
  extractPageData,
  fetchHtml,
  normalizeText,
  socialFromUrl,
  validEmail,
} from '../server/company-service.mjs'

test('normalizes French accents and punctuation', () => {
  assert.equal(normalizeText('  Société Générale—S.A.S. '), 'societe generale s a s')
})

test('scores exact and partial company names without false exact matches', () => {
  assert.equal(companyMatchScore('La Poste', 'LA POSTE'), 100)
  assert.ok(companyMatchScore('Air France', 'AIR FRANCE - KLM GROUP') >= 80)
  assert.ok(companyMatchScore('Air France', 'Boulangerie du Village') < 30)
})

test('accepts public emails and rejects placeholders or image filenames', () => {
  assert.equal(validEmail('mailto:Contact@Entreprise.fr?subject=Bonjour'), 'contact@entreprise.fr')
  assert.equal(validEmail('team@example.com'), null)
  assert.equal(validEmail('tracking@2x.png'), null)
  assert.equal(validEmail('not-an-email'), null)
})

test('canonicalizes company social profiles and rejects posts or personal profiles', () => {
  assert.deepEqual(socialFromUrl('https://www.facebook.com/laposte/?fbclid=tracking'), {
    platform: 'facebook', url: 'https://facebook.com/laposte', handle: '@laposte',
  })
  assert.equal(socialFromUrl('https://instagram.com/p/abc123'), null)
  assert.equal(socialFromUrl('https://www.linkedin.com/in/private-person'), null)
  assert.equal(socialFromUrl('https://fr.linkedin.com/company/la-poste-groupe')?.handle, '@la-poste-groupe')
})

test('extracts emails, contact links and verified social links from official pages', () => {
  const html = `
    <html><body>
      <script>const hidden = 'fake@example.com'</script>
      <a href="mailto:Contact@Societe.fr">Écrivez-nous</a>
      <a href="/nous-contacter">Nous contacter</a>
      <a href="https://facebook.com/societe.fr">Facebook</a>
      <a href="https://instagram.com/societe">Instagram</a>
      <a href="https://linkedin.com/company/societe">LinkedIn</a>
      <a href="https://outside.example/contact">External contact</a>
      <p>Support : support@societe.fr</p>
    </body></html>`
  const data = extractPageData(html, 'https://www.societe.fr/', 'https://www.societe.fr/')
  assert.deepEqual(data.emails.sort(), ['contact@societe.fr', 'support@societe.fr'])
  assert.equal(data.contactLinks[0].url, 'https://www.societe.fr/nous-contacter')
  assert.deepEqual(data.socials.map((item) => item.platform), ['facebook', 'instagram', 'linkedin'])
  assert.ok(!data.emails.includes('fake@example.com'))
})

test('blocks local network URLs during website retrieval', async () => {
  await assert.rejects(() => fetchHtml('http://127.0.0.1:8080/admin'), /Private address blocked/)
  await assert.rejects(() => fetchHtml('file:///C:/Windows/win.ini'), /Unsupported URL protocol/)
})
