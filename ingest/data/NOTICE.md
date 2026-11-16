# Data notices

This project reads two open datasets. Both are MIT-licensed; their notices are kept here as the licence asks.

## Company names and board lists (`data/boards/*.csv`)

Taken from [stapply-ai/ats-scrapers](https://github.com/stapply-ai/ats-scrapers), folder `ats-companies/`, on 13 November 2026. MIT License, Copyright (c) 2026 Kalil Bouzigues. Rows were reduced to two columns (name, slug) for the seven hiring systems this board uses, and Workday entries were shortened to the tenant name. That project's `SOURCES.md` records that some of its candidate boards came from the `latmay/ats-career-page-urls` dataset (CC BY 4.0) and from Common Crawl's URL index.

## Daily postings snapshot (read at run time, not stored here)

The nightly run clones [Feashliaa/job-board-data](https://github.com/Feashliaa/job-board-data), the data store of the job-board-aggregator project. MIT License, Copyright (c) 2026 Riley Dorrington. Only the title, location, link, hiring system, board name and first-seen date of matching postings are used. The dataset's salary field is an estimate and is never used.

## The listings themselves

Job postings belong to the employers who wrote them. The board shows a title, location, short excerpts and a link back to the employer's own posting.
