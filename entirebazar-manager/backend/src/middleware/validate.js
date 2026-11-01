'use strict';

/** Validates req[source] with a zod schema; parsed output lands in req.valid[source]. */
module.exports = function validate(schema, source = 'body') {
  return (req, _res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) return next(result.error);
    req.valid = req.valid || {};
    req.valid[source] = result.data;
    return next();
  };
};
