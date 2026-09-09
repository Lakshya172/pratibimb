;; S-02a-2 WASM kernel — deliberately the SAME workload as the WebGPU probe, so the two
;; are directly comparable on one machine and one browser:  out[i] = in[i] * 2 + 1
;;
;; Input  i32 array at byte offset 0
;; Output i32 array at byte offset n*4
;; 64 pages = 4 MiB, enough for 262,144 i32 in and out (2 MiB).
;;
;; Throwaway spike code. No product code.
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
        (i32.store
          (i32.add (local.get $outbase) (local.get $off))
          (i32.add
            (i32.mul (i32.load (local.get $off)) (i32.const 2))
            (i32.const 1)))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $loop)))))
