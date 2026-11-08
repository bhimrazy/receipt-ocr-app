# cord (5 fixtures)

Source: https://huggingface.co/datasets/Voxel51/consolidated_receipt_dataset (FiftyOne copy of CORD v1 train, 800 images). Original: https://github.com/clovaai/cord
Licence: CC-BY-4.0 (confirmed on the HF card and the CORD GitHub README). Attribution required: Park, Shin, Lee, Lee, Surh, Seo, Lee (NAVER CLOVA AI), "CORD: A Consolidated Receipt Dataset for Post-OCR Parsing", NeurIPS 2019 Document Intelligence Workshop.
Real Indonesian receipt photos. Store name, address and date were blurred/removed by the authors for privacy, so `merchant` and `receiptDate` are `null` (a model should return no date). Labels (samples.json: menu.nm/cnt/price, sub_total._, total._) were used for the numbers and checked against the image.

Selection (dataset index): 0 long 22 lines + service + PB1 tax + rounding; 3 discount + service + tax; 33 per-item discounts, low light; 36 service + tax, wrapped item names; 750 promo discount + service + tax, dim hand-held photo.
Images are the original PNGs, converted to lossless WebP (pixel-identical). samples.json (5.6 MB) was read once for labels and is not kept here.
