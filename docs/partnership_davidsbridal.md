# David's Bridal — Партнёрство

Документ-чеклист для подключения к David's Bridal на двух треках:
**(A) Affiliate** (быстрый, автоматический) и **(B) Прямой outreach** (медленнее, эксклюзивные условия).

---

## A. Affiliate-программа через Rakuten Advertising

David's Bridal работает через **Rakuten Advertising** (бывший LinkShare).
Это даст право использовать их product-фото в маркетинговых целях
+ комиссию 6-8% с каждой продажи по твоей ссылке.

### Шаг 1. Регистрация в Rakuten Advertising как издатель (publisher)

URL: <https://rakutenadvertising.com/affiliate-marketing/>

Нажми **"Become a Publisher"**. Заполни форму:

| Поле | Пример значения |
|---|---|
| Country | United States *(или твоя страна — но US имеет больше offers)* |
| Website name | Try Wedding Dress |
| Website URL | `https://trywedding.dress` *(или текущий tunnel-URL — но лучше задеплоить на постоянный домен до подачи заявки, см. ниже)* |
| Website description | AI-powered virtual try-on web app for wedding dresses. Users upload a photo and instantly preview themselves wearing dresses from leading retailers, with click-through to purchase. |
| Vertical / category | Bridal & Wedding · Fashion · Technology |
| Monetization model | CPA (commission per sale) |
| Estimated monthly traffic | Pre-launch — projecting 10-50k visits/month within 90 days |
| Promotional methods | Content marketing, organic social (TikTok/Instagram), SEO, paid ads |
| Tax info | EIN или ITIN если из США; иначе W-8BEN form |
| Payment method | PayPal / Wire / Direct deposit |

**Важно перед подачей:**
1. **Задеплой сайт на постоянный домен** — Rakuten не одобряет сайты на временных tunnel-URL'ах с basic-auth. Рекомендую Fly.io + домен (~$10/year на Namecheap). Я могу помочь с деплоем.
2. **Убери basic-auth** на проде — публичный сайт.
3. **Добавь страницы**: Privacy Policy, Terms of Service, About Us, Contact. Это формальное требование для одобрения. Шаблоны есть на termly.io / iubenda.
4. **Минимум 3-5 страниц контента**: главная + try-on + about + privacy + terms.
5. **Профильные соцсети** не обязательны, но + к шансам одобрения. Создай Instagram/TikTok @trywedding.dress и опубликуй 3-5 постов с примерами try-on.

**Срок одобрения**: 1-7 рабочих дней.

### Шаг 2. Подать заявку конкретно к David's Bridal

После одобрения как publisher → войти в Rakuten Advertising dashboard →
секция **"Programs"** или **"Advertisers"** → найти **David's Bridal** →
нажать **"Apply"**.

В заявке укажи:
- Что планируешь делать (virtual try-on с их платьями)
- Ожидаемый трафик
- Promotion plan: какие категории платьев, какие сегменты аудитории

David's Bridal обычно одобряет publisher'ов с релевантным трафиком за 3-5 дней.

### Шаг 3. После одобрения

1. Возьми **product feed** — Rakuten отдаёт XML/CSV с полным каталогом
   David's Bridal (картинки, цены, описания, SKU, deep-links). Файл
   обновляется ежедневно.
2. Замени текущий вручную спарсенный `catalog.json` на скрипт-импортёр
   из feed'а (могу написать как только будет доступ).
3. Замени внешние ссылки в модалке на **affiliate deep-links** с
   твоим SubID — теперь каждая покупка по этим ссылкам приносит
   комиссию.

---

## B. Прямой outreach к David's Bridal Business Development

Параллельно стучись напрямую — если получится, можно договориться на
эксклюзивные условия (увеличенная комиссия, featured placement,
co-marketing, ранний доступ к коллекциям).

### Контакты

| Тип | Email | Когда писать |
|---|---|---|
| **Партнёрства / BD** | `partnerships@davidsbridal.com` | первичный контакт |
| **PR / Media** | `pr@davidsbridal.com` | для PR-кампаний |
| **Marketing** | `marketing@davidsbridal.com` | для co-marketing |
| **HQ phone** | +1 610-943-5000 | если нужно эскалировать |
| LinkedIn | <https://www.linkedin.com/company/david's-bridal/> | искать VP Marketing / Director of Partnerships |

### Шаблон email (EN)

Скопируй и адаптируй:

```
Subject: AI Virtual Try-On Partnership — Driving Qualified Bridal Traffic

Hi David's Bridal Partnerships team,

I'm [YOUR NAME], founder of Try Wedding Dress
(https://trywedding.dress) — an AI-powered virtual try-on web app
that lets brides upload a photo and instantly see themselves wearing
real wedding dresses from leading retailers.

We're currently in pre-launch and are featuring David's Bridal as
the primary catalog source in our demo (with full attribution and
direct click-through links to your product pages). We'd love to
formalize this partnership.

Two paths I'd like to explore:

1. **Affiliate participation** — I'll join your Rakuten Advertising
   program. We'd send qualified, high-intent traffic (brides actively
   shopping for dresses) and track conversions transparently.

2. **Featured partnership** — exclusive collection placement in our
   try-on UI, joint social campaigns (TikTok/IG), early access to
   new collections, and a higher commission tier in exchange for
   guaranteed visibility and co-marketing.

What we offer:
- Highly engaged bridal audience driven by viral try-on content
- Full SKU attribution and product-page deep-links
- Real-time analytics on which dresses brides try on
- Co-branded marketing collateral

Demo: [your live URL]
Deck: [optional — attach a 5-slide PDF if you have one]

Could we schedule a 20-minute call this or next week?

Best,
[YOUR NAME]
[Email] · [Phone] · [LinkedIn]
```

**Tip**: отправляй с бизнес-email (например `partnerships@trywedding.dress`),
не с gmail/proton — это сильно повышает open-rate.

### Что сильно повысит шансы

1. **Готовый pitch deck** (5-10 слайдов): проблема, решение, демо,
   аудитория, метрики, конкретное предложение. Могу собрать draft.
2. **MVP с реальными метриками** — даже 1000 уникальных пользователей
   за 30 дней даёт серьёзный аргумент.
3. **Социальные доказательства** — несколько viral постов TikTok с
   try-on'ами от реальных невест.
4. **Введение через знакомства** — LinkedIn-сообщения VP Marketing
   David's Bridal с упоминанием взаимного контакта работают в 5x
   лучше холодных email'ов.
5. **PR-хук** — пост в TechCrunch / Vogue Business / Modern Bride о
   запуске. Тогда тебе сами напишут.

---

## C. Альтернативные платформы (на случай отказа)

Если David's Bridal не подойдёт — другие варианты с публичными
affiliate-программами в той же категории:

| Ритейлер | Платформа | Комиссия | Регистрация |
|---|---|---|---|
| Azazie | ShareASale | 8-10% | <https://shareasale.com/r.cfm?b=1059541&u=&m=72018> |
| Lulus (bridal section) | Impact | 6-12% | <https://impact.com/affiliate-platform/> |
| BHLDN (Anthropologie) | Rakuten | 4-6% | через Rakuten dashboard |
| Adore Bridal | прямая программа | 10% | <https://adorebridal.com/affiliates> |
| ASOS | Awin | 5% | <https://www.awin.com/> |

---

## D. Что я могу сделать на нашей стороне

После твоего одобрения / выбора:

- [ ] Задеплоить сайт на постоянный домен (Fly.io / Vercel) — нужно для регистрации
- [ ] Создать страницы Privacy Policy, Terms of Service, About, Contact (шаблоны)
- [ ] Подключить product feed (XML/CSV) для авто-импорта каталога
- [ ] Добавить affiliate-параметры в external links (SubID-tracking)
- [ ] Собрать pitch deck (5-10 слайдов в PDF)
- [ ] Подготовить landing page для запросов от ритейлеров
- [ ] Настроить email на бизнес-домене (Google Workspace / Proton Mail / Zoho)

Скажи что делаем дальше — могу всё это последовательно.
