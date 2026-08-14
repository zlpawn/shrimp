package example;

public class BindingController {
    private final BindingService service;

    public BindingController(BindingService service) {
        this.service = service;
    }

    public boolean bind(String projectId, String node) {
        return service.bind(projectId, node);
    }
}
