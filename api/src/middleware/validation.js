const { z } = require('zod');

/**
 * Zod schema for incoming transaction payloads.
 * Validates all required fields with sensible constraints.
 */
const transactionSchema = z.object({
  card_hash: z
    .string()
    .min(8, 'card_hash must be at least 8 characters')
    .max(64, 'card_hash must be at most 64 characters'),

  amount: z
    .number()
    .positive('amount must be positive')
    .max(1_000_000, 'amount cannot exceed 1,000,000'),

  currency: z
    .string()
    .length(3, 'currency must be a 3-letter ISO code')
    .default('USD'),

  merchant_id: z
    .string()
    .max(64)
    .optional(),

  merchant_category: z
    .string()
    .max(32)
    .optional(),

  latitude: z
    .number()
    .min(-90)
    .max(90)
    .optional(),

  longitude: z
    .number()
    .min(-180)
    .max(180)
    .optional(),

  country: z
    .string()
    .length(2, 'country must be a 2-letter ISO code')
    .optional(),

  timestamp: z
    .string()
    .datetime({ offset: true })
    .optional(),
});

/**
 * Express middleware that validates the request body against the transaction schema.
 */
function validateTransaction(req, res, next) {
  const result = transactionSchema.safeParse(req.body);

  if (!result.success) {
    const errors = result.error.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    }));

    return res.status(400).json({
      error: 'Validation failed',
      details: errors,
    });
  }

  // Attach validated data to request
  req.validatedBody = result.data;
  next();
}

module.exports = { validateTransaction, transactionSchema };
