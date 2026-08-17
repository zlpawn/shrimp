package example;

public class PreviewBindingService implements BindingService {
    @Override
    public boolean bind(String projectId, String node) {
        return "preview".equals(node);
    }
}
