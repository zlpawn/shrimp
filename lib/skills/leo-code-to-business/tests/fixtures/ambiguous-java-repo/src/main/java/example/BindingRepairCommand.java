package example;

public class BindingRepairCommand {
    private final BindingRepository repository;

    public BindingRepairCommand(BindingRepository repository) {
        this.repository = repository;
    }

    public void relink(String projectId, String node) {
        repository.writeBinding(projectId, node, "BOUND");
    }
}
