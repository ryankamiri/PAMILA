# PAMILA Product Design Doc

PAMILA stands for "Please assist me in locating apartments."

PAMILA is a personal apartment curation cockpit for finding NYC housing for a summer internship. It is not meant to be a production app, a public marketplace, or a generic apartment search engine. It is designed for one person, one internship, one city, and one urgent outcome: find the best viable place fast without letting dozens of messy listings turn into chaos.

The app should help browse Airbnb and Leasebreak, save promising listings, apply precise filters, rank options intelligently, and give clear next actions. The experience should feel like a smart search assistant that says what to look at next, what to reject, what needs clarification, and why a listing is or is not worth attention.

## Product Context

The user is searching for housing for a summer internship at Ramp in New York City.

Office destination:

```text
Ramp
28 West 23rd Street, Floor 2
New York, NY 10010
```

Target housing dates:

```text
Preferred start: June 30, 2026 or July 1, 2026
Required end: September 12, 2026
```

Budget:

```text
Maximum advertised monthly rent: $3,600
```

The $3,600 cap is a hard cap on advertised monthly rent. Extra fees, taxes, cleaning fees, and deposits can be tracked separately, but the primary budget filter uses advertised monthly rent unless the user explicitly changes this later.

Sources:

- Airbnb
- Leasebreak

No other listing sources are in scope for the first product definition.

Cost constraint:

- PAMILA should not rely on paid APIs, paid map services, paid scraping tools, paid listing feeds, or paid SaaS features.
- If a product idea depends on a paid service, it should be deferred or replaced with a free/local/manual workflow.

## Vision

PAMILA should make apartment searching feel less like browsing and more like triage.

The user should be able to collect a messy set of listings from Airbnb and Leasebreak, then let PAMILA organize them into:

- listings worth acting on now
- listings worth saving but not urgent
- listings that need missing data
- listings that should be rejected
- fallback options if the search is going badly

The app should be opinionated. It should know the user's budget, dates, office, commute preferences, and geography preferences. It should not require the user to rethink the same constraints every time a listing appears.

The core promise:

> PAMILA turns Airbnb and Leasebreak browsing into a ranked, explainable, commute-aware shortlist for the Ramp internship.

## Product Principles

1. **Fast decisions over perfect data**
   PAMILA should help the user decide quickly even when listings are incomplete. Unknowns should become visible risk flags, not blockers.

2. **Hard filters stay hard**
   A listing over the $3,600 advertised monthly rent cap should be excluded from normal results even if everything else is excellent.

3. **Rankings must explain themselves**
   Every high or low score should have a plain-English reason. The user should never wonder why a listing ranked where it did.

4. **Manual cleanup is acceptable when it saves time overall**
   The user is willing to confirm details like address, amenities, or exact dates for serious listings. PAMILA should keep this cleanup lightweight and focused.

5. **Fallbacks should be explicit**
   Private rooms, looser commute limits, and borderline date fits should not quietly blend into the main search. They should appear only when fallback mode is enabled or when clearly marked.

6. **Product before automation**
   The product should define what a great search assistant does. Technical implementation, scraping strategy, database choices, and routing implementation are separate future decisions.

## User Workflow

### 1. Browse Source Sites

The user searches Airbnb and Leasebreak directly. PAMILA should assume the user is still using those sites as the front door for discovery.

The product should eventually support a "save to PAMILA" style flow where the user can save a listing they are already viewing. PAMILA should then import or prompt for the key details needed to rank it.

### 2. Save Listings Into PAMILA

Saved listings enter the Inbox. Inbox listings may be incomplete. For example, a listing might have a URL and price but no exact address, no washer detail, or unclear date coverage.

PAMILA should immediately classify each imported listing as one of:

- ready to rank
- needs cleanup
- likely reject
- duplicate or already reviewed

### 3. Clean Only What Matters

PAMILA should ask for missing details only when they affect eligibility or ranking.

Examples:

- If the listing is over budget, do not ask the user to clean up amenities.
- If the listing is promising but has no exact address, ask the user to confirm the address or nearest cross streets.
- If Leasebreak dates are ambiguous, ask the user to confirm whether a June 30 or July 1 move-in is likely acceptable.
- If Airbnb stay type is unclear, ask the user to confirm entire apartment vs private room.

### 4. Review The Daily Queue

The Daily Queue is the main home screen. It should tell the user what to do next.

Example queue items:

- Review these 5 new high-fit listings.
- Message this host to confirm July 1 start.
- Confirm exact address before trusting commute.
- Reject this listing because advertised rent is over $3,600.
- Move this listing to fallback because it is a private room.
- Compare these 3 finalists.

The Daily Queue should avoid dumping every listing on the user at once. It should surface the smallest useful set of actions.

### 5. Shortlist And Compare

Listings that pass hard filters and rank well should move into the Shortlist. The Shortlist is for serious candidates only.

Finalist comparison should show tradeoffs clearly:

- price
- location
- commute
- date fit
- stay type
- bedroom count
- washer
- kitchen
- bathroom
- risk flags
- notes
- current contact/status

### 6. Contact And Track Status

PAMILA should help track what has happened with each serious listing.

Suggested statuses:

- New
- Needs cleanup
- Ready to review
- Shortlisted
- Contacted
- Waiting for response
- Rejected by user
- Rejected by host/landlord
- No longer available
- Finalist
- Chosen

PAMILA does not need to send messages itself in the product definition. It should help decide who to message and what to ask.

## Core Views

### Daily Queue

The Daily Queue is the default view and main command center.

It should answer:

- What should I look at right now?
- What listing is most promising?
- What listing needs one missing detail?
- What should I reject?
- What should I message today?

It should group actions by urgency and value, not by source.

### Inbox

The Inbox contains newly saved or partially parsed listings.

Inbox goals:

- show what was imported
- identify missing fields
- detect obvious rejects
- prevent promising listings from getting lost

### Shortlist

The Shortlist contains realistic candidates. A listing should only enter the Shortlist if it is under the hard budget cap and plausibly covers the needed dates.

The Shortlist should be sorted by PAMILA Score by default.

### Map And Commute View

This view should help the user understand where listings are relative to Ramp and how the commute feels.

It should show:

- listing location or approximate location
- commute time
- transfers
- walk time to transit
- bus-heavy warnings
- neighborhood/geography category

The map is a decision aid, not the main product. A listing should not seem good only because it looks close on a map.

### Compare View

Compare View should support side-by-side comparison of a small number of finalists.

It should make tradeoffs obvious:

- "best commute but worse date fit"
- "cheapest but farther"
- "Manhattan and convenient but no washer listed"
- "great price but private room, fallback only"

### Listing Detail

Listing Detail should show the full decision context for one listing.

It should include:

- source and original URL
- imported listing facts
- editable user-confirmed facts
- PAMILA Score
- score explanation
- hard filter status
- commute summary
- date fit summary
- amenities
- risk flags
- notes
- next suggested action
- contact/status history

### Settings

Settings should hold the user's current search constraints.

Initial settings:

- office address: Ramp, 28 West 23rd Street, Floor 2, New York, NY 10010
- target start: June 30, 2026 or July 1, 2026
- target end: September 12, 2026
- max advertised monthly rent: $3,600
- default stay type: entire apartment only
- fallback stay type: private room
- ideal commute: 20 minutes or less
- acceptable commute: around 30 to 35 minutes
- long walk threshold: over 10 minutes
- heavy walk threshold: over 15 minutes
- preferred geography: Manhattan first, LIC/Astoria second, Brooklyn allowed

## Listing Model

This is a product-level listing model, not a database schema.

Each listing should track:

- source: Airbnb or Leasebreak
- original URL
- title or short label
- advertised monthly rent
- total known fees, if available
- stay type: entire apartment, private room, unknown
- bedroom rule match: studio, 1 bedroom, 2 bedroom, studio+, exact bedroom count, unknown
- bathroom situation: private, shared, unknown
- kitchen: yes, no, unknown
- washer: in unit, in building, nearby/laundromat, no, unknown
- furnished: yes, no, unknown
- date availability summary
- earliest move-in date
- latest move-in date
- earliest move-out date
- latest move-out date
- month-to-month flag
- location: exact address, cross streets, neighborhood, or approximate area
- geography category: Manhattan, LIC/Astoria, Brooklyn, other
- commute summary
- transit lines or route summary
- walk time to transit
- transfer count
- bus-heavy flag
- PAMILA Score
- score explanation
- risk flags
- user notes
- listing status
- next suggested action

Unknown values should be allowed. PAMILA should visibly mark unknowns that matter.

## Filters

### Hard Filters

Hard filters determine whether a listing belongs in normal results.

Initial hard filters:

- source must be Airbnb or Leasebreak
- advertised monthly rent must be at or below $3,600
- listing must plausibly cover June 30/July 1 through September 12
- stay type must be entire apartment in normal mode
- commute should not be clearly over the acceptable range unless fallback mode is enabled

Hard filters should be explainable. If a listing is excluded, PAMILA should say why.

Examples:

- Excluded: advertised rent is $3,850, above the $3,600 cap.
- Excluded: private room hidden until Panic/Fallback Mode.
- Excluded: available only after July 15, leaving a housing gap.

### Precise Bedroom Filters

PAMILA should support exact and flexible bedroom filters.

Examples:

- studio only
- studio or 1 bedroom
- studio+
- 1 bedroom only
- exactly 2 bedrooms
- 2 bedrooms or more

Bedroom filters should be precise because the user may want different searches at different moments.

### Amenity Filters

Amenities can be hard filters or ranking preferences.

Initial product stance:

- kitchen is important and should be highlighted when missing or unknown
- private bathroom is important, especially if private rooms are enabled
- washer is a strong bonus, not a hard requirement
- furnished should be tracked and likely important for short-term summer housing

### Source Filters

The user should be able to view:

- Airbnb only
- Leasebreak only
- both sources

Source should not override hard constraints.

## Ranking System

PAMILA Score should be transparent and practical. It should help sort serious listings, not pretend to be mathematically perfect.

The score should be based on:

- date fit
- price fit
- commute quality
- geography preference
- stay type
- bedroom fit
- amenities
- uncertainty and risk

Every score should include a short explanation.

Example:

```text
Score: 87
Great commute: 19 minutes, 0 transfers.
Covers full internship dates.
Advertised rent is $3,450, under the $3,600 cap.
Entire apartment in Manhattan.
Penalty: washer not listed.
```

### Date Fit

Date fit is one of the most important ranking factors.

Best matches:

- starts June 30, 2026 and ends September 12, 2026 or later
- starts July 1, 2026 and ends September 12, 2026 or later

Good matches:

- starts a few days earlier and covers through September 12
- month-to-month with strong evidence that the full internship period is possible

Riskier matches:

- starts significantly earlier, requiring extra rent
- date window technically works but the owner appears to prefer earlier move-in
- end date is flexible or unclear
- month-to-month without enough detail

Bad matches:

- starts after July 1 and creates a housing gap
- ends before September 12
- cannot confirm summer availability

### Leasebreak Date Handling

Leasebreak date fields need special handling because the listing may include:

- earliest move-in date
- latest move-in date
- earliest move-out date
- latest move-out date
- immediate move-in
- month-to-month or flexible terms

PAMILA should not simply ask, "Does the user's date range fit somewhere in the window?"

If a listing says immediate move-in or strongly emphasizes an earlier move-in, PAMILA should keep the listing eligible only if the latest move-in and move-out windows support the user's dates. However, it should apply a date-risk penalty because the landlord or tenant may reject a later June 30 or July 1 start.

Example:

```text
Date fit: Medium risk
The listing allows move-in by July 1, but earliest move-in is immediate.
The owner may prefer someone who can start sooner.
Suggested action: ask whether a July 1 start is acceptable.
```

This matters because Leasebreak users may reject applicants even when the latest move-in date technically allows the user's desired date.

### Airbnb Date Handling

Airbnb listings should distinguish:

- entire apartment
- private room
- shared room or unclear stay type

Entire apartments are included in normal mode.

Private rooms are hidden in normal mode and shown only in Panic/Fallback Mode.

Airbnb date fit should consider whether the listing is available for the full stay from June 30/July 1 through September 12. If Airbnb pricing is shown as a total instead of monthly rent, PAMILA should let the user track advertised monthly equivalent separately.

### Price Fit

Price ranking should reward listings comfortably below the $3,600 cap.

However, price should not beat core livability. A cheaper listing with a bad commute, uncertain dates, or shared bathroom should not automatically outrank a slightly more expensive but much better listing.

Over-budget listings are excluded from normal results.

### Commute Quality

Commute quality should reflect how the trip feels, not only total minutes.

The office destination is Ramp at 28 West 23rd Street.

Commute preferences:

- ideal: 20 minutes or less
- good: 21 to 30 minutes
- acceptable but penalized: 31 to 35 minutes
- normally hidden or heavily penalized: over 35 minutes

Priorities:

- fewer transfers
- shorter walk to transit
- subway-heavy routes
- predictable routes

Long walk rules:

- over 10 minutes to transit: penalty
- over 15 minutes to transit: heavy penalty

Bus-heavy rule:

- penalize routes where bus is the main transit leg or most in-vehicle transit time
- do not automatically reject a short bus connector if the route is otherwise excellent

Example:

```text
Commute fit: Good
24 minutes to Ramp.
0 transfers.
6 minute walk to subway.
Subway-heavy route.
```

Example:

```text
Commute fit: Risky
19 minutes on paper, but includes 13 minute walk and bus as the main leg.
Penalty: long walk and bus-heavy route.
```

### Geography Preference

Geography should influence ranking before and alongside commute.

Initial preference order:

1. Manhattan
2. LIC/Astoria
3. Brooklyn
4. Other areas

Manhattan receives a strong bonus because the user strongly prefers living in Manhattan.

LIC/Astoria are acceptable and can rank well if commute and price are strong.

Brooklyn is allowed but should usually rank below comparable Manhattan or LIC/Astoria options. A Brooklyn listing can outrank a Manhattan listing if the Manhattan listing has major penalties such as worse dates, worse commute, missing essentials, or higher risk.

## Guidance Layer

PAMILA should actively tell the user what to do.

The product should generate short, concrete instructions instead of passive labels.

Examples:

- Review this today.
- Message host to confirm July 1 start.
- Ask whether the exact address is near a subway.
- Confirm whether bathroom is private.
- Reject because price is over hard cap.
- Reject because date range ends before September 12.
- Move to fallback because it is a private room.
- Keep as backup because date fit is good but commute is 34 minutes.
- Compare against the Chelsea listing before messaging.

Guidance should be practical and calm. It should reduce mental load.

## Panic/Fallback Mode

Panic/Fallback Mode is a deliberate mode for when the main search is not producing enough viable entire-apartment options.

When Panic/Fallback Mode is off:

- private rooms are hidden from normal results
- entire apartments are the default
- budget remains hard
- date fit remains strict
- commute tolerance remains around 30 to 35 minutes

When Panic/Fallback Mode is on:

- private rooms appear
- private bathroom and kitchen access become more important
- borderline date fits become visible but clearly marked
- commute tolerance may loosen slightly
- PAMILA should separate fallback options from strong main-search options

Private rooms should never silently mix into normal results. The user should know when fallback mode is shaping the results.

## Review Scenarios

These scenarios define whether the product behavior is correct.

### Scenario 1: Ideal Manhattan Apartment

A Manhattan entire apartment costs $3,450/month, covers July 1 through September 12, has an 18-minute subway commute, 0 transfers, and a 5-minute walk to transit.

Expected behavior:

- included in normal results
- ranks near the top
- receives strong date, commute, geography, and stay-type scores
- next action is to review or message

### Scenario 2: Leasebreak Immediate Move-In But Window Works

A Leasebreak listing says immediate move-in, latest move-in is after July 1, and move-out can cover September 12.

Expected behavior:

- remains eligible
- receives a date-risk penalty
- explains that the owner may prefer someone earlier
- suggests asking whether a July 1 start is acceptable

### Scenario 3: Over Budget

A listing costs $3,750/month but has a perfect commute.

Expected behavior:

- excluded from normal results
- explanation says advertised rent exceeds the $3,600 hard cap
- does not rank above under-budget listings

### Scenario 4: Private Room In Normal Mode

An Airbnb private room costs $2,400/month and has a good commute.

Expected behavior:

- hidden from normal results
- appears only in Panic/Fallback Mode
- marked as private room fallback

### Scenario 5: Faster Route Feels Worse

Listing A has a 22-minute subway commute, 0 transfers, and a 6-minute walk.

Listing B has a 19-minute commute but includes a 13-minute walk and bus as the main transit leg.

Expected behavior:

- Listing A ranks higher on commute quality
- Listing B receives long-walk and bus-heavy penalties
- score explanation makes the tradeoff clear

### Scenario 6: Brooklyn Can Win, But Only With Reasons

A Brooklyn listing has excellent dates, $3,000 rent, and a 24-minute commute. A Manhattan listing has uncertain dates, $3,600 rent, and a 34-minute commute.

Expected behavior:

- Brooklyn listing can outrank the Manhattan listing
- explanation notes that Manhattan is preferred, but the Brooklyn option wins on date fit, price, and commute

### Scenario 7: Month-To-Month Listing

A month-to-month listing appears to allow the target period but does not clearly guarantee availability through September 12.

Expected behavior:

- not automatically rejected
- receives uncertainty/risk notes
- suggests confirming full-period availability before shortlisting

## Out Of Scope For This Product Doc

This document intentionally does not decide:

- app framework
- database
- browser extension implementation
- scraping strategy
- routing engine
- map provider
- deployment approach
- authentication
- paid API alternatives

Those decisions belong in a future technical design document.

## Success Criteria

PAMILA is successful if it helps the user:

- quickly identify the best Airbnb and Leasebreak listings
- avoid wasting time on listings that violate hard constraints
- understand date and commute tradeoffs
- keep promising listings organized
- know what to do next each day
- maintain a clear shortlist of realistic finalists

The product should feel useful even with partially manual data entry. It should make the housing search faster, calmer, and more precise.
