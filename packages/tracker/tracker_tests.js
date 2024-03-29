Tinytest.add('tracker - run', function (test) {
  var d = new Tracker.Dependency;
  var x = 0;
  var handle = Tracker.autorun(function (handle) {
    d.depend();
    ++x;
  });
  test.equal(x, 1);
  Tracker.flush();
  test.equal(x, 1);
  d.changed();
  test.equal(x, 1);
  Tracker.flush();
  test.equal(x, 2);
  d.changed();
  test.equal(x, 2);
  Tracker.flush();
  test.equal(x, 3);
  d.changed();
  // Prevent the function from running further.
  handle.stop();
  Tracker.flush();
  test.equal(x, 3);
  d.changed();
  Tracker.flush();
  test.equal(x, 3);

  Tracker.autorun(function (internalHandle) {
    d.depend();
    ++x;
    if (x == 6)
      internalHandle.stop();
  });
  test.equal(x, 4);
  d.changed();
  Tracker.flush();
  test.equal(x, 5);
  d.changed();
  // Increment to 6 and stop.
  Tracker.flush();
  test.equal(x, 6);
  d.changed();
  Tracker.flush();
  // Still 6!
  test.equal(x, 6);

  test.throws(function () {
    Tracker.autorun();
  });
  test.throws(function () {
    Tracker.autorun({});
  });
});

Tinytest.add("tracker - nested run", function (test) {
  var a = new Tracker.Dependency;
  var b = new Tracker.Dependency;
  var c = new Tracker.Dependency;
  var d = new Tracker.Dependency;
  var e = new Tracker.Dependency;
  var f = new Tracker.Dependency;

  var buf = "";

  var c1 = Tracker.autorun(function () {
    a.depend();
    buf += 'a';
    Tracker.autorun(function () {
      b.depend();
      buf += 'b';
      Tracker.autorun(function () {
        c.depend();
        buf += 'c';
        var c2 = Tracker.autorun(function () {
          d.depend();
          buf += 'd';
          Tracker.autorun(function () {
            e.depend();
            buf += 'e';
            Tracker.autorun(function () {
              f.depend();
              buf += 'f';
            });
          });
          Tracker.onInvalidate(function () {
            // only run once
            c2.stop();
          });
        });
      });
    });
    Tracker.onInvalidate(function (c1) {
      c1.stop();
    });
  });

  var expect = function (str) {
    test.equal(buf, str);
    buf = "";
  };

  expect('abcdef');

  test.isTrue(a.hasDependents());
  test.isTrue(b.hasDependents());
  test.isTrue(c.hasDependents());
  test.isTrue(d.hasDependents());
  test.isTrue(e.hasDependents());
  test.isTrue(f.hasDependents());

  b.changed();
  expect(''); // didn't flush yet
  Tracker.flush();
  expect('bcdef');

  c.changed();
  Tracker.flush();
  expect('cdef');

  var changeAndExpect = function (v, str) {
    v.changed();
    Tracker.flush();
    expect(str);
  };

  // should cause running
  changeAndExpect(e, 'ef');
  changeAndExpect(f, 'f');
  // invalidate inner context
  changeAndExpect(d, '');
  // no more running!
  changeAndExpect(e, '');
  changeAndExpect(f, '');

  test.isTrue(a.hasDependents());
  test.isTrue(b.hasDependents());
  test.isTrue(c.hasDependents());
  test.isFalse(d.hasDependents());
  test.isFalse(e.hasDependents());
  test.isFalse(f.hasDependents());

  // rerun C
  changeAndExpect(c, 'cdef');
  changeAndExpect(e, 'ef');
  changeAndExpect(f, 'f');
  // rerun B
  changeAndExpect(b, 'bcdef');
  changeAndExpect(e, 'ef');
  changeAndExpect(f, 'f');

  test.isTrue(a.hasDependents());
  test.isTrue(b.hasDependents());
  test.isTrue(c.hasDependents());
  test.isTrue(d.hasDependents());
  test.isTrue(e.hasDependents());
  test.isTrue(f.hasDependents());

  // kill A
  a.changed();
  changeAndExpect(f, '');
  changeAndExpect(e, '');
  changeAndExpect(d, '');
  changeAndExpect(c, '');
  changeAndExpect(b, '');
  changeAndExpect(a, '');

  test.isFalse(a.hasDependents());
  test.isFalse(b.hasDependents());
  test.isFalse(c.hasDependents());
  test.isFalse(d.hasDependents());
  test.isFalse(e.hasDependents());
  test.isFalse(f.hasDependents());
});

Tinytest.add("tracker - flush", function (test) {

  var buf = "";

  var c1 = Tracker.autorun(function (c) {
    buf += 'a';
    // invalidate first time
    if (c.firstRun)
      c.invalidate();
  });

  test.equal(buf, 'a');
  Tracker.flush();
  test.equal(buf, 'aa');
  Tracker.flush();
  test.equal(buf, 'aa');
  c1.stop();
  Tracker.flush();
  test.equal(buf, 'aa');

  //////

  buf = "";

  var c2 = Tracker.autorun(function (c) {
    buf += 'a';
    // invalidate first time
    if (c.firstRun)
      c.invalidate();

    Tracker.onInvalidate(function () {
      buf += "*";
    });
  });

  test.equal(buf, 'a*');
  Tracker.flush();
  test.equal(buf, 'a*a');
  c2.stop();
  test.equal(buf, 'a*a*');
  Tracker.flush();
  test.equal(buf, 'a*a*');

  /////
  // Can flush a different run from a run;
  // no current computation in afterFlush

  buf = "";

  var c3 = Tracker.autorun(function (c) {
    buf += 'a';
    // invalidate first time
    if (c.firstRun)
      c.invalidate();
    Tracker.afterFlush(function () {
      buf += (Tracker.active ? "1" : "0");
    });
  });

  Tracker.afterFlush(function () {
    buf += 'c';
  });

  var c4 = Tracker.autorun(function (c) {
    c4 = c;
    buf += 'b';
  });

  Tracker.flush();
  test.equal(buf, 'aba0c0');
  c3.stop();
  c4.stop();
  Tracker.flush();

  // cases where flush throws

  var ran = false;
  Tracker.afterFlush(function (arg) {
    ran = true;
    test.equal(typeof arg, 'undefined');
    test.throws(function () {
      Tracker.flush(); // illegal nested flush
    });
  });

  Tracker.flush();
  test.isTrue(ran);

  test.throws(function () {
    Tracker.autorun(function () {
      Tracker.flush(); // illegal to flush from a computation
    });
  });

  test.throws(function () {
    Tracker.autorun(function () {
      Tracker.autorun(function () {});
      Tracker.flush();
    });
  });
});

Tinytest.add("tracker - lifecycle", function (test) {

  test.isFalse(Tracker.active);
  test.equal(null, Tracker.currentComputation);

  var runCount = 0;
  var firstRun = true;
  var buf = [];
  var cbId = 1;
  var makeCb = function () {
    var id = cbId++;
    return function () {
      buf.push(id);
    };
  };

  var shouldStop = false;

  var c1 = Tracker.autorun(function (c) {
    test.isTrue(Tracker.active);
    test.equal(c, Tracker.currentComputation);
    test.equal(c.stopped, false);
    test.equal(c.invalidated, false);
    test.equal(c.firstRun, firstRun);

    Tracker.onInvalidate(makeCb()); // 1, 6, ...
    Tracker.afterFlush(makeCb()); // 2, 7, ...

    Tracker.autorun(function (x) {
      x.stop();
      c.onInvalidate(makeCb()); // 3, 8, ...

      Tracker.onInvalidate(makeCb()); // 4, 9, ...
      Tracker.afterFlush(makeCb()); // 5, 10, ...
    });
    runCount++;

    if (shouldStop)
      c.stop();
  });

  firstRun = false;

  test.equal(runCount, 1);

  test.equal(buf, [4]);
  c1.invalidate();
  test.equal(runCount, 1);
  test.equal(c1.invalidated, true);
  test.equal(c1.stopped, false);
  test.equal(buf, [4, 1, 3]);

  Tracker.flush();

  test.equal(runCount, 2);
  test.equal(c1.invalidated, false);
  test.equal(buf, [4, 1, 3, 9, 2, 5, 7, 10]);

  // test self-stop
  buf.length = 0;
  shouldStop = true;
  c1.invalidate();
  test.equal(buf, [6, 8]);
  Tracker.flush();
  test.equal(buf, [6, 8, 14, 11, 13, 12, 15]);

});

Tinytest.add("tracker - onInvalidate", function (test) {
  var buf = "";

  var c1 = Tracker.autorun(function () {
    buf += "*";
  });

  var append = function (x, expectedComputation) {
    return function (givenComputation) {
      test.isFalse(Tracker.active);
      test.equal(givenComputation, expectedComputation || c1);
      buf += x;
    };
  };

  c1.onStop(append('s'));

  c1.onInvalidate(append('a'));
  c1.onInvalidate(append('b'));
  test.equal(buf, '*');
  Tracker.autorun(function (me) {
    Tracker.onInvalidate(append('z', me));
    me.stop();
    test.equal(buf, '*z');
    c1.invalidate();
  });
  test.equal(buf, '*zab');
  c1.onInvalidate(append('c'));
  c1.onInvalidate(append('d'));
  test.equal(buf, '*zabcd');
  Tracker.flush();
  test.equal(buf, '*zabcd*');

  // afterFlush ordering
  buf = '';
  c1.onInvalidate(append('a'));
  c1.onInvalidate(append('b'));
  Tracker.afterFlush(function () {
    append('x')(c1);
    c1.onInvalidate(append('c'));
    c1.invalidate();
    Tracker.afterFlush(function () {
      append('y')(c1);
      c1.onInvalidate(append('d'));
      c1.invalidate();
    });
  });
  Tracker.afterFlush(function () {
    append('z')(c1);
    c1.onInvalidate(append('e'));
    c1.invalidate();
  });

  test.equal(buf, '');
  Tracker.flush();
  test.equal(buf, 'xabc*ze*yd*');

  buf = "";
  c1.onInvalidate(append('m'));
  Tracker.flush();
  test.equal(buf, '');
  c1.stop();
  test.equal(buf, 'ms');  // s is from onStop
  Tracker.flush();
  test.equal(buf, 'ms');
  c1.onStop(append('S'));
  test.equal(buf, 'msS');
});

Tinytest.add('tracker - invalidate at flush time', function (test) {
  // Test this sentence of the docs: Functions are guaranteed to be
  // called at a time when there are no invalidated computations that
  // need rerunning.

  var buf = [];

  Tracker.afterFlush(function () {
    buf.push('C');
  });

  // When c1 is invalidated, it invalidates c2, then stops.
  var c1 = Tracker.autorun(function (c) {
    if (! c.firstRun) {
      buf.push('A');
      c2.invalidate();
      c.stop();
    }
  });

  var c2 = Tracker.autorun(function (c) {
    if (! c.firstRun) {
      buf.push('B');
      c.stop();
    }
  });

  // Invalidate c1.  If all goes well, the re-running of
  // c2 should happen before the afterFlush.
  c1.invalidate();
  Tracker.flush();

  test.equal(buf.join(''), 'ABC');

});

Tinytest.add('tracker - throwFirstError', function (test) {
  var d = new Tracker.Dependency;
  Tracker.autorun(function (c) {
    d.depend();

    if (!c.firstRun)
      throw new Error("foo");
  });

  d.changed();
  // doesn't throw; logs instead.
  Meteor._suppress_log(1);
  Tracker.flush();

  d.changed();
  test.throws(function () {
    Tracker.flush({_throwFirstError: true});
  }, /foo/);
});

Tinytest.addAsync('tracker - no infinite recomputation', function (test, onComplete) {
  var reran = false;
  var c = Tracker.autorun(function (c) {
    if (! c.firstRun)
      reran = true;
    c.invalidate();
  });
  test.isFalse(reran);
  Meteor.setTimeout(function () {
    c.stop();
    Tracker.afterFlush(function () {
      test.isTrue(reran);
      test.isTrue(c.stopped);
      onComplete();
    });
  }, 100);
});

Tinytest.add('tracker - Tracker.flush finishes', function (test) {
  // Currently, _runFlush will "yield" every 1000 computations... unless run in
  // Tracker.flush. So this test validates that Tracker.flush is capable of
  // running 2000 computations. Which isn't quite the same as infinity, but it's
  // getting there.
  var n = 0;
  var c = Tracker.autorun(function (c) {
    if (++n < 2000) {
      c.invalidate();
    }
  });
  test.equal(n, 1);
  Tracker.flush();
  test.equal(n, 2000);
});

testAsyncMulti('tracker - Tracker.autorun, onError option', [function (test, expect) {
  var d = new Tracker.Dependency;
  var c = Tracker.autorun(function (c) {
    d.depend();

    if (! c.firstRun)
      throw new Error("foo");
  }, {
    onError: expect(function (err) {
      test.equal(err.message, "foo");
    })
  });

  d.changed();
  Tracker.flush();
}]);

Tinytest.addAsync('tracker - async function - basics', function (test, onComplete) {
  const computation = Tracker.autorun(async function (computation) {
    test.equal(computation.firstRun, true, 'before (firstRun)');
    test.equal(Tracker.currentComputation, computation, 'before');
    const x = await Promise.resolve().then(() =>
      Tracker.withComputation(computation, () => {
        // The `firstRun` is `false` as soon as the first `await` happens.
        test.equal(computation.firstRun, false, 'inside (firstRun)');
        test.equal(Tracker.currentComputation, computation, 'inside');
        return 123;
      })
    );
    test.equal(x, 123, 'await (value)');
    test.equal(computation.firstRun, false, 'await (firstRun)');
    Tracker.withComputation(computation, () => {
      test.equal(Tracker.currentComputation, computation, 'await');
    });
    await new Promise(resolve => setTimeout(resolve, 10));
    Tracker.withComputation(computation, () => {
      test.equal(computation.firstRun, false, 'sleep (firstRun)');
      test.equal(Tracker.currentComputation, computation, 'sleep');
    });
    try {
      await Promise.reject('example');
      test.fail();
    } catch (error) {
      Tracker.withComputation(computation, () => {
        test.equal(error, 'example', 'catch (error)');
        test.equal(computation.firstRun, false, 'catch (firstRun)');
        test.equal(Tracker.currentComputation, computation, 'catch');
      });
    }
    onComplete();
  });

  test.equal(Tracker.currentComputation, null, 'outside (computation)');
  test.instanceOf(computation, Tracker.Computation, 'outside (result)');
});

Tinytest.addAsync('tracker - async function - interleaved', async function (test) {
  let count = 0;
  const limit = 100;
  for (let index = 0; index < limit; ++index) {
    Tracker.autorun(async function (computation) {
      test.equal(Tracker.currentComputation, computation, `before (${index})`);
      await new Promise(resolve => setTimeout(resolve, Math.random() * limit));
      count++;
      Tracker.withComputation(computation, () => {
        test.equal(Tracker.currentComputation, computation, `after (${index})`);
      });
    });
  }

  test.equal(count, 0, 'before resolve');
  await new Promise(resolve => setTimeout(resolve, limit));
  test.equal(count, limit, 'after resolve');
});

Tinytest.addAsync('tracker - async function - parallel', async function (test) {
  let resolvePromise;
  const promise = new Promise(resolve => {
    resolvePromise = resolve;
  });

  let count = 0;
  const limit = 100;
  const dependency = new Tracker.Dependency();
  for (let index = 0; index < limit; ++index) {
    Tracker.autorun(async function (computation) {
      count++;
      Tracker.withComputation(computation, () => {
        dependency.depend();
      });
      await promise;
      count--;
    });
  }

  test.equal(count, limit, 'before');
  dependency.changed();
  await new Promise(setTimeout);
  test.equal(count, limit * 2, 'changed');
  resolvePromise();
  await new Promise(setTimeout);
  test.equal(count, 0, 'after');
});

Tinytest.addAsync('tracker - async function - stepped', async function (test) {
  let resolvePromise;
  const promise = new Promise(resolve => {
    resolvePromise = resolve;
  });

  let count = 0;
  const limit = 100;
  for (let index = 0; index < limit; ++index) {
    Tracker.autorun(async function (computation) {
      test.equal(Tracker.currentComputation, computation, `before (${index})`);
      await promise;
      count++;
      Tracker.withComputation(computation, () => {
        test.equal(Tracker.currentComputation, computation, `after (${index})`);
      });
    });
  }

  test.equal(count, 0, 'before resolve');
  resolvePromise();
  await new Promise(setTimeout);
  test.equal(count, limit, 'after resolve');
});

Tinytest.addAsync('tracker - async function - synchronize', async test => {
  let counter = 0;

  await Tracker.autorun(async () => {
    test.equal(counter, 0);
    counter += 1;
    test.equal(counter, 1);
    await new Promise(resolve => setTimeout(resolve));
    test.equal(counter, 1);
    counter *= 2;
    test.equal(counter, 2);
  });

  await Tracker.autorun(async () => {
    test.equal(counter, 2);
    counter += 1;
    test.equal(counter, 3);
    await new Promise(resolve => setTimeout(resolve));
    test.equal(counter, 3);
    counter *= 2;
    test.equal(counter, 6);
  });
})

Tinytest.addAsync('tracker - async function - synchronize - firstRunPromise', async test => {
  let counter = 0
  await Tracker.autorun(async () => {
    test.equal(counter, 0);
    counter += 1;
    test.equal(counter, 1);
    await new Promise(resolve => setTimeout(resolve));
    test.equal(counter, 1);
    counter *= 2;
    test.equal(counter, 2);
  }).firstRunPromise;

  await Tracker.autorun(async () => {
    test.equal(counter, 2);
    counter += 1;
    test.equal(counter, 3);
    await new Promise(resolve => setTimeout(resolve));
    test.equal(counter, 3);
    counter *= 2;
    test.equal(counter, 6);
  }).firstRunPromise;
})

Tinytest.add('computation - #flush', function (test) {
  var i = 0, j = 0, d = new Tracker.Dependency;
  var c1 = Tracker.autorun(function () {
    d.depend();
    i = i + 1;
  });
  var c2 = Tracker.autorun(function () {
    d.depend();
    j = j + 1;
  });
  test.equal(i,1);
  test.equal(j,1);

  d.changed();
  c1.flush();
  test.equal(i, 2);
  test.equal(j, 1);

  Tracker.flush();
  test.equal(i, 2);
  test.equal(j, 2);
});

Tinytest.add('computation - #run', function (test) {
  var i = 0, d = new Tracker.Dependency, d2 = new Tracker.Dependency;
  var computation = Tracker.autorun(function (c) {
    d.depend();
    i = i + 1;
    //when #run() is called, this dependency should be picked up
    if (i>=2 && i<4) { d2.depend(); }
  });
  test.equal(i,1);
  computation.run();
  test.equal(i,2);

  d.changed(); Tracker.flush();
  test.equal(i,3);

  //we expect to depend on d2 at this point
  d2.changed(); Tracker.flush();
  test.equal(i,4);

  //we no longer depend on d2, only d
  d2.changed(); Tracker.flush();
  test.equal(i,4);
  d.changed(); Tracker.flush();
  test.equal(i,5);
});
