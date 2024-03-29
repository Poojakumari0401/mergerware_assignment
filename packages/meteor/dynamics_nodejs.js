// Fiber-aware implementation of dynamic scoping, for use on the server

var Fiber = Npm.require('fibers');

var nextSlot = 0;
var callAsyncMethodRunning = false;

Meteor._nodeCodeMustBeInFiber = function () {
  if (!Fiber.current) {
    throw new Error("Meteor code must always run within a Fiber. " +
                    "Try wrapping callbacks that you pass to non-Meteor " +
                    "libraries with Meteor.bindEnvironment.");
  }
};

/**
 * @memberOf Meteor
 * @summary Constructor for EnvironmentVariable
 * @locus Anywhere
 * @class
 */
Meteor.EnvironmentVariable = function () {
  this.slot = nextSlot++;
};

var EVp = Meteor.EnvironmentVariable.prototype;

/**
 * @summary Return value of environment variable if available
 * @locus Anywhere
 * @method get
 * @memberof Meteor.EnvironmentVariable
 */
EVp.get = function () {
  Meteor._nodeCodeMustBeInFiber();

  return Fiber.current._meteor_dynamics &&
    Fiber.current._meteor_dynamics[this.slot];
};

// Most Meteor code ought to run inside a fiber, and the
// _nodeCodeMustBeInFiber assertion helps you remember to include appropriate
// bindEnvironment calls (which will get you the *right value* for your
// environment variables, on the server).
//
// In some very special cases, it's more important to run Meteor code on the
// server in non-Fiber contexts rather than to strongly enforce the safeguard
// against forgetting to use bindEnvironment. For example, using `check` in
// some top-level constructs like connect handlers without needing unnecessary
// Fibers on every request is more important that possibly failing to find the
// correct argumentChecker. So this function is just like get(), but it
// returns null rather than throwing when called from outside a Fiber. (On the
// client, it is identical to get().)
EVp.getOrNullIfOutsideFiber = function () {
  if (!Fiber.current)
    return null;
  return this.get();
};

/**
 * @summary Set the environment variable to the given value while a function is run
 * @locus Anywhere
 * @method withValue
 * @memberof Meteor.EnvironmentVariable
 * @param {Any} value Value the environment variable should be set to
 * @param {Function} func The function to run
 * @return {Any} Return value of function
 */
EVp.withValue = function (value, func) {
  Meteor._nodeCodeMustBeInFiber();

  if (!Fiber.current._meteor_dynamics)
    Fiber.current._meteor_dynamics = [];
  var currentValues = Fiber.current._meteor_dynamics;

  var saved = currentValues[this.slot];
  try {
    currentValues[this.slot] = value;
    return Meteor.wrapFn(func)();
  } finally {
    currentValues[this.slot] = saved;
  }
};

/**
 * @summary Set the environment variable to the given value while a function is run
 * @locus Anywhere
 * @method withValueAsync
 * @memberof Meteor.EnvironmentVariable
 * @param {Any} value Value the environment variable should be set to
 * @param {Function} func The function to run
 * @return {Any} Return value of function
 */

EVp._set = function (context) {
  Meteor._nodeCodeMustBeInFiber();
  Fiber.current._meteor_dynamics[this.slot] = context;
};

EVp._setNewContextAndGetCurrent = function (value) {
  Meteor._nodeCodeMustBeInFiber();
  if (!Fiber.current._meteor_dynamics) {
    Fiber.current._meteor_dynamics = [];
  }
  const saved = Fiber.current._meteor_dynamics[this.slot];
  this._set(value);
  return saved;
};

EVp._isCallAsyncMethodRunning = function () {
	return callAsyncMethodRunning;
};

EVp._setCallAsyncMethodRunning = function (value) {
	callAsyncMethodRunning = value;
};


// Meteor application code is always supposed to be run inside a
// fiber. bindEnvironment ensures that the function it wraps is run from
// inside a fiber and ensures it sees the values of Meteor environment
// variables that are set at the time bindEnvironment is called.
//
// If an environment-bound function is called from outside a fiber (eg, from
// an asynchronous callback from a non-Meteor library such as MongoDB), it'll
// kick off a new fiber to execute the function, and returns undefined as soon
// as that fiber returns or yields (and func's return value is ignored).
//
// If it's called inside a fiber, it works normally (the
// return value of the function will be passed through, and no new
// fiber will be created.)
//
// `onException` should be a function or a string.  When it is a
// function, it is called as a callback when the bound function raises
// an exception.  If it is a string, it should be a description of the
// callback, and when an exception is raised a debug message will be
// printed with the description.
/**
 * @summary Stores the current Meteor environment variables, and wraps the
 * function to run with the environment variables restored. On the server, the
 * function is wrapped within a fiber.
 * @locus Anywhere
 * @memberOf Meteor
 * @param {Function} func Function that is wrapped
 * @param {Function} onException
 * @param {Object} _this Optional `this` object against which the original function will be invoked
 * @return {Function} The wrapped function
 */
Meteor.bindEnvironment = function (func, onException, _this) {
  Meteor._nodeCodeMustBeInFiber();

  var dynamics = Fiber.current._meteor_dynamics;
  var boundValues = dynamics ? dynamics.slice() : [];

  if (!onException || typeof(onException) === 'string') {
    var description = onException || "callback of async function";
    onException = function (error) {
      Meteor._debug(
        "Exception in " + description + ":",
        error
      );
    };
  } else if (typeof(onException) !== 'function') {
    throw new Error('onException argument must be a function, string or undefined for Meteor.bindEnvironment().');
  }

  return function (/* arguments */) {
    var args = Array.prototype.slice.call(arguments);

    var runWithEnvironment = function () {
      var savedValues = Fiber.current._meteor_dynamics;
      try {
        // Need to clone boundValues in case two fibers invoke this
        // function at the same time
        Fiber.current._meteor_dynamics = boundValues.slice();
        var ret = func.apply(_this, args);
      } catch (e) {
        // note: callback-hook currently relies on the fact that if onException
        // throws and you were originally calling the wrapped callback from
        // within a Fiber, the wrapped call throws.
        onException(e);
      } finally {
        Fiber.current._meteor_dynamics = savedValues;
      }
      return ret;
    };

    if (Fiber.current)
      return runWithEnvironment();
    Fiber(runWithEnvironment).run();
  };
};
