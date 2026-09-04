package example;

import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;

@FeignClient(name = "recorder")
public interface LinjingVideoProcessFeign {
    @PostMapping("/linjing/video/concat/callback")
    Boolean saveConcatResult(
        @RequestBody Object result,
        @RequestHeader("tenant") String tenant
    );
}
