;; SIMD feature probe: compiles only if the engine supports the v128 proposal.
;; Same arithmetic, four lanes at a time.
(module
  (memory (export "mem") 64)
  (func (export "run") (param $n i32)
    (local $i i32)
    (local $off i32)
    (local $outbase i32)
    (local.set $outbase (i32.mul (local.get $n) (i32.const 4)))
    (block $done
      (loop $loop
        (br_if $done (i32.ge_u (local.get $i) (local.get $n)))
        (local.set $off (i32.mul (local.get $i) (i32.const 4)))
        (v128.store
          (i32.add (local.get $outbase) (local.get $off))
          (i32x4.add
            (i32x4.mul (v128.load (local.get $off)) (i32x4.splat (i32.const 2)))
            (i32x4.splat (i32.const 1))))
        (local.set $i (i32.add (local.get $i) (i32.const 4)))
        (br $loop)))))
